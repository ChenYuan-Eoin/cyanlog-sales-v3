// REQ: F054 / WP97. Tenant-side APL thin caller for the ICU CRM intake gateway.
//
// This file is a deployable tenant artifact, not the ICU server. Replace every
// __CONFIGURE__ / REPLACE_* value from the reviewed tenant JSON before install.
// Never commit the client secret. The function performs provider reads only;
// its sole external writes are the signed ICU preflight/create calls. Carrier
// booking remains in ICU after a human confirms the exact shipment.

def CONFIG = [
  schemaVersion: '1.0',
  mode: 'preflight',
  environment: 'production',
  enterpriseId: '__CONFIGURE_FXIAOKE_ENTERPRISE_ID__',
  endpoint: [
    baseUrl: 'https://sales.cyanlog.icu',
    clientId: '__CONFIGURE_CRM_CLIENT_ID__',
    clientSecret: 'REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS',
    preflightPath: '/api/shipping/crm/preflight',
    createPath: '/api/shipping/crm/orders',
    timeoutMs: 15000,
    preflightRetryCount: 1,
    createRetryCount: 1,
  ],
  workflow: [
    objectApiName: '__CONFIGURE_WORKFLOW_OBJECT_API_NAME__',
    acceptedInstanceStates: ['in_progress', 'pass'],
    stages: [[
      taskName: '__CONFIGURE_APPROVAL_TASK_NAME__',
      stageId: '__CONFIGURE_APPROVAL_STAGE_ID__',
      acceptedTaskStates: ['pass'],
    ]],
  ],
  applicant: [
    objectApiName: 'PersonnelObj',
    employeeId: [kind: 'field', path: '_id', select: 'raw'],
    name: [kind: 'field', path: 'name', select: 'raw'],
    phone: [kind: 'field', path: 'mobile', select: 'raw'],
    departmentId: [kind: 'field', path: 'department_id', select: 'raw'],
    departmentName: [kind: 'field', path: 'department_name', select: 'raw'],
  ],
  rootObject: [
    objectApiName: '__CONFIGURE_WORKFLOW_OBJECT_API_NAME__',
    customerId: [kind: 'field', path: 'account__c', select: 'id'],
    customerName: [kind: 'field', path: 'account__c', select: 'name'],
    revisionId: [kind: 'field', path: 'modified_time', select: 'raw'],
  ],
  shipmentDetailObject: [
    objectApiName: '__CONFIGURE_SHIPMENT_DETAIL_OBJECT_API_NAME__',
    parentRecordId: [kind: 'field', path: '__CONFIGURE_PARENT_FIELD__', select: 'id'],
    shipment: [
      recipient: [kind: 'fields',
        name: [kind: 'field', path: 'recipient_name', select: 'raw'],
        phone: [kind: 'field', path: 'recipient_phone', select: 'raw'],
        province: [kind: 'field', path: 'province', select: 'raw'],
        city: [kind: 'field', path: 'city', select: 'raw'],
        county: [kind: 'field', path: 'county', select: 'raw'],
        address: [kind: 'field', path: 'address', select: 'raw'],
      ],
      cargo: [kind: 'field', path: 'cargo', select: 'raw'],
      weight: [kind: 'field', path: 'weight', select: 'raw'],
      servicePreference: [kind: 'field', path: 'service_preference', select: 'raw'],
      payment: [kind: 'literal', value: 'sender_monthly'],
      remark: [kind: 'literal', value: ''],
    ],
  ],
]

def CONFIG_TOKEN = '__CONFIGURE_'
def SECRET_PLACEHOLDER = 'REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS'
def CANONICALIZATION = 'crm-json-v1'
def CANONICALIZATION_HEADER = 'x-shipping-crm-canonicalization'
def REQUIRED_HEADER_NAMES = [
  'Content-Type',
  'x-shipping-crm-client-id',
  'x-shipping-crm-timestamp',
  'x-shipping-crm-signature',
  CANONICALIZATION_HEADER,
]

def fail = { String code, String message ->
  Fx.message.throwException(message + ' [' + code + ']')
}

def requireMap = { Object value, String label ->
  if (!(value instanceof Map)) fail('APL_INVALID_SHAPE', label + '不是对象')
  return value as Map
}

def requireList = { Object value, String label ->
  if (!(value instanceof List)) fail('APL_INVALID_SHAPE', label + '不是列表')
  return value as List
}

def safeText = { Object value ->
  if (value == null) return ''
  String result = String.valueOf(value).trim()
  return result == 'null' ? '' : result
}

def requiredText = { Object value, String label ->
  String result = safeText(value)
  if (result.isEmpty()) fail('APL_REQUIRED_VALUE_MISSING', label + '缺失')
  return result
}

def requiredBoundedText = { Object value, String label, int maxLength ->
  String result = requiredText(value, label)
  if (result.length() > maxLength) fail('APL_VALUE_INVALID', label + '超长')
  return result
}

def requiredPhone = { Object value, String label ->
  String result = requiredBoundedText(value, label, 30)
  if (!(result ==~ /^(?:1[3-9]\d{9}|0\d{2,3}[- ]?\d{7,8}(?:[- ]\d{1,6})?)$/)) {
    fail('APL_VALUE_INVALID', label + '不是国内手机号或带区号的座机')
  }
  return result
}

def boundedInteger = { Object value, String label, int minValue, int maxValue ->
  String text = requiredText(value, label)
  int result
  try {
    result = Integer.parseInt(text)
  } catch (NumberFormatException ignored) {
    fail('APL_CONFIG_INVALID', label + '不是有效整数')
  }
  if (result < minValue || result > maxValue) fail('APL_CONFIG_INVALID', label + '超出允许范围')
  return result
}

def requiredAddress = { Object value, String label ->
  String result = requiredBoundedText(value, label, 200)
  def vague = java.util.regex.Pattern.compile('(?:附近|周边|一带|待补充|待定|不详|未知|联系后告知|电话联系)$')
  def named = java.util.regex.Pattern.compile('[\\p{L}\\d]+(?:村|屯|庄|寨|社区|小区|园|园区|营区|基地|部队|大厦|写字楼|中心|仓库|学校|大学|医院|码头|车站|公司|工厂)')
  def numbered = java.util.regex.Pattern.compile('\\d|[一二三四五六七八九十百]+(?:号|栋|幢|楼|室)')
  if (vague.matcher(result).find()) fail('APL_VALUE_INVALID', label + '缺少具体投递地点')
  if (named.matcher(result).find()) return result
  if (result.length() >= 5 && numbered.matcher(result).find()) return result
  fail('APL_VALUE_INVALID', label + '缺少具体投递地点')
}

def identifier = { Object value, String label ->
  String result = requiredText(value, label)
  if (!(result ==~ /^[A-Za-z0-9._:@-]+$/)) fail('APL_IDENTIFIER_INVALID', label + '格式无效')
  return result
}

def objectApiName = { Object value, String label ->
  String result = requiredText(value, label)
  if (!(result ==~ /^[A-Za-z][A-Za-z0-9_]*$/)) fail('APL_OBJECT_NAME_INVALID', label + '格式无效')
  return result
}

def fieldApiName = { Object value, String label ->
  String result = requiredText(value, label)
  if (!(result ==~ /^[A-Za-z_][A-Za-z0-9_]*$/)) fail('APL_FIELD_NAME_INVALID', label + '格式无效')
  return result
}

def canonicalJson

def escapeJson = { String value ->
  StringBuilder out = new StringBuilder()
  value.each { String ch ->
    int code = (int) ch.charAt(0)
    switch (ch) {
      case '\\': out.append('\\\\'); break
      case '"': out.append('\\"'); break
      case '\b': out.append('\\b'); break
      case '\f': out.append('\\f'); break
      case '\n': out.append('\\n'); break
      case '\r': out.append('\\r'); break
      case '\t': out.append('\\t'); break
      default:
        if (code < 0x20) out.append(String.format('\\u%04x', code))
        else out.append(ch)
    }
  }
  return out.toString()
}

canonicalJson = { Object value ->
  if (value == null) return 'null'
  if (value instanceof Boolean) return value ? 'true' : 'false'
  if (value instanceof Number) {
    if (value instanceof BigDecimal) return value.stripTrailingZeros().toPlainString()
    return String.valueOf(value)
  }
  if (value instanceof CharSequence || value instanceof Character) {
    return '"' + escapeJson(String.valueOf(value)) + '"'
  }
  if (value instanceof Map) {
    Map source = value as Map
    List keys = source.keySet().collect { String.valueOf(it) }.sort()
    return '{' + keys.collect { String key ->
      '"' + escapeJson(key) + '":' + canonicalJson(source[key])
    }.join(',') + '}'
  }
  if (value instanceof Iterable) {
    return '[' + (value as Iterable).collect { canonicalJson(it) }.join(',') + ']'
  }
  fail('APL_CANONICALIZATION_FAILED', '请求内容包含无法规范化的值')
}

def sourceValue = { Object raw, String select ->
  Object value = raw
  if (value instanceof Iterable && !(value instanceof CharSequence)) {
    List values = value as List
    if (values.isEmpty()) return null
    if (values.size() != 1) fail('APL_MAPPING_AMBIGUOUS', '字段包含多个引用，不能自动选择第一项')
    value = values[0]
  }
  if (value instanceof Map) {
    if (select == 'id') return value['_id'] ?: value['id']
    if (select == 'name') return value['name'] ?: value['label']
  }
  return value
}

def mappedValue = { Map source, Map spec, String label ->
  if (spec == null) fail('APL_MAPPING_INVALID', label + '未配置')
  String kind = safeText(spec['kind'])
  if (kind == 'literal') return spec['value']
  if (kind != 'field') fail('APL_MAPPING_INVALID', label + '映射类型无效')
  String path = fieldApiName(spec['path'], label + '.path')
  if (path.startsWith(CONFIG_TOKEN)) fail('APL_CONFIG_PLACEHOLDER', label + '.path 仍是未配置占位值')
  return sourceValue(source[path], safeText(spec['select']) ?: 'raw')
}

def mappedText = { Map source, Map spec, String label ->
  return safeText(mappedValue(source, spec, label))
}

def mappedRequired = { Map source, Map spec, String label ->
  return requiredText(mappedValue(source, spec, label), label)
}

def uniqueColumns = { List<Map> specs ->
  return specs.findAll { it != null && safeText(it['kind']) == 'field' }
    .collect { fieldApiName(it['path'], '字段映射') }
    .unique()
}

def fqlFor = { List columns ->
  return FQLAttribute.builder().columns(['_id'] + columns.unique()).build()
}

def findObject = { String apiName, String objectId, List columns, String label ->
  def (Object error, Object result, Object message) = Fx.object.findById(
    objectApiName(apiName, label),
    identifier(objectId, label + '.id'),
    fqlFor(columns),
    SelectAttribute.builder().needInvalid(false).build(),
  )
  if (error == true) fail('APL_OBJECT_READ_FAILED', label + '读取失败')
  Map record = requireMap(result, label)
  if (safeText(record['_id']) != objectId) fail('APL_OBJECT_MISMATCH', label + '返回值与请求不一致')
  return record
}

def configuredValue = { Object value, String label ->
  String text = requiredText(value, label)
  if (text.startsWith(CONFIG_TOKEN)) fail('APL_CONFIG_PLACEHOLDER', label + '仍是未配置占位值')
  return text
}

def validateConfig = {
  if (safeText(CONFIG['schemaVersion']) != '1.0') fail('APL_CONFIG_INVALID', 'APL 配置版本无效')
  configuredValue(CONFIG['enterpriseId'], 'enterpriseId')
  Map endpoint = requireMap(CONFIG['endpoint'], 'endpoint')
  configuredValue(endpoint['clientId'], 'endpoint.clientId')
  String secret = requiredText(endpoint['clientSecret'], 'endpoint.clientSecret')
  if (secret == SECRET_PLACEHOLDER || secret.length() < 32) fail('APL_CONFIG_INVALID', '客户端密钥未配置')
  String baseUrl = configuredValue(endpoint['baseUrl'], 'endpoint.baseUrl')
  String environment = safeText(CONFIG['environment'])
  if (!(safeText(CONFIG['mode']) in ['preflight', 'create'])) fail('APL_CONFIG_INVALID', 'mode 必须为 preflight 或 create')
  if (!(environment in ['development', 'production'])) fail('APL_CONFIG_INVALID', 'environment 无效')
  if (environment == 'production' && baseUrl != 'https://sales.cyanlog.icu') {
    fail('APL_CONFIG_INVALID', '生产模式只能调用正式 ICU')
  }
  if (environment == 'development' && !(baseUrl ==~ /^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/)) {
    fail('APL_CONFIG_INVALID', '开发模式只能调用已核验的隔离 Preview 地址')
  }
  if (safeText(endpoint['preflightPath']) != '/api/shipping/crm/preflight') fail('APL_CONFIG_INVALID', '预检路径无效')
  if (safeText(endpoint['createPath']) != '/api/shipping/crm/orders') fail('APL_CONFIG_INVALID', '受理路径无效')
  boundedInteger(endpoint['timeoutMs'], 'endpoint.timeoutMs', 1000, 120000)
  boundedInteger(endpoint['preflightRetryCount'], 'endpoint.preflightRetryCount', 0, 3)
  boundedInteger(endpoint['createRetryCount'], 'endpoint.createRetryCount', 0, 3)

  Map workflow = requireMap(CONFIG['workflow'], 'workflow')
  objectApiName(configuredValue(workflow['objectApiName'], 'workflow.objectApiName'), 'workflow.objectApiName')
  List acceptedInstanceStates = requireList(workflow['acceptedInstanceStates'], 'workflow.acceptedInstanceStates')
  if (acceptedInstanceStates.isEmpty()) fail('APL_CONFIG_INVALID', '审批实例状态不能为空')
  acceptedInstanceStates.each { Object stateValue ->
    String state = requiredText(stateValue, 'workflow.acceptedInstanceStates[]')
    if (!(state in ['in_progress', 'pass', 'cancel', 'error'])) fail('APL_CONFIG_INVALID', '审批实例状态不受支持')
  }
  List stages = requireList(workflow['stages'], 'workflow.stages')
  if (stages.size() != 1) fail('APL_CONFIG_INVALID', '一个 APL 事件只能绑定一个审批阶段')
  Map stage = requireMap(stages[0], 'workflow.stages[0]')
  String taskId = safeText(stage['taskId'])
  String taskName = safeText(stage['taskName'])
  if (taskId.isEmpty() == taskName.isEmpty()) {
    fail('APL_CONFIG_INVALID', 'taskId 与 taskName 必须且只能配置一个')
  }
  if (!taskId.isEmpty()) configuredValue(taskId, 'workflow.stages[0].taskId')
  if (!taskName.isEmpty()) configuredValue(taskName, 'workflow.stages[0].taskName')
  configuredValue(stage['stageId'], 'workflow.stages[0].stageId')
  if (requireList(stage['acceptedTaskStates'], 'workflow.stages[0].acceptedTaskStates').isEmpty()) {
    fail('APL_CONFIG_INVALID', '审批任务状态不能为空')
  }

  Map applicant = requireMap(CONFIG['applicant'], 'applicant')
  objectApiName(configuredValue(applicant['objectApiName'], 'applicant.objectApiName'), 'applicant.objectApiName')
  Map root = requireMap(CONFIG['rootObject'], 'rootObject')
  objectApiName(configuredValue(root['objectApiName'], 'rootObject.objectApiName'), 'rootObject.objectApiName')
  Map detail = requireMap(CONFIG['shipmentDetailObject'], 'shipmentDetailObject')
  objectApiName(configuredValue(detail['objectApiName'], 'shipmentDetailObject.objectApiName'), 'shipmentDetailObject.objectApiName')
  Map shipment = requireMap(detail['shipment'], 'shipmentDetailObject.shipment')
  if ((shipment['serviceId'] == null) == (shipment['servicePreference'] == null)) {
    fail('APL_CONFIG_INVALID', 'serviceId 与 servicePreference 必须且只能配置一个')
  }
}

validateConfig()

Map contextRecord = requireMap(context.data ?: [:], 'context.data')
String recordId = identifier(contextRecord['_id'], 'context.data._id')
Object rawArg = context.arg
if (rawArg != null && !(rawArg instanceof Map)) fail('APL_INVALID_SHAPE', 'context.arg 不是对象')
Map arg = rawArg instanceof Map ? rawArg as Map : [:]
String workflowInstanceIdArg = safeText(arg['workflowInstanceId'])
String shipmentDetailIdArg = safeText(arg['shipmentDetailId'])
String taskIdArg = safeText(arg['taskId'])
String recordIdArg = safeText(arg['recordId'])
if (!recordIdArg.isEmpty() && identifier(recordIdArg, 'recordId') != recordId) {
  fail('APL_CONTEXT_RECORD_MISMATCH', '函数上下文业务记录与输入不一致')
}

String tenantId = identifier(context.tenantId, 'context.tenantId')
if (tenantId != safeText(CONFIG['enterpriseId'])) {
  fail('APL_TENANT_MISMATCH', '函数执行租户与已审核企业不一致')
}

Map workflow = CONFIG['workflow'] as Map
Map stage = (workflow['stages'] as List)[0] as Map
String workflowObjectApiName = objectApiName(workflow['objectApiName'], 'workflow.objectApiName')
String contextObjectApiName = safeText(contextRecord['object_describe_api_name'])
if (!contextObjectApiName.isEmpty() && objectApiName(contextObjectApiName, 'context.data.object_describe_api_name') != workflowObjectApiName) {
  fail('APL_CONTEXT_OBJECT_MISMATCH', '函数上下文对象与已审核审批对象不一致')
}
String configuredTaskId = safeText(stage['taskId'])
String configuredTaskName = safeText(stage['taskName'])
String stageId = configuredValue(stage['stageId'], 'workflow.stage.stageId')

List acceptedInstanceStates = requireList(workflow['acceptedInstanceStates'], 'workflow.acceptedInstanceStates')
List matchingInstances = []
acceptedInstanceStates.each { Object stateValue ->
  String state = requiredText(stateValue, 'workflow.acceptedInstanceStates[]')
  Object instanceEnvelopeRaw = Fx.bpm.findInstances(
    workflowObjectApiName, state, recordId, 10, 1,
  )
  Map instanceEnvelope = requireMap(instanceEnvelopeRaw, 'Fx.bpm.findInstances')
  if (instanceEnvelope['isError'] == true || instanceEnvelope['error'] == true) {
    fail('APL_INSTANCE_READ_FAILED', '审批实例读取失败')
  }
  Map payload = requireMap(instanceEnvelope['data'], 'Fx.bpm.findInstances.data')
  Map queryResult = requireMap(payload['QueryResult'], 'Fx.bpm.findInstances.QueryResult')
  List rows = requireList(queryResult['dateList'], 'Fx.bpm.findInstances.dateList')
  rows.each { Object row ->
    Map instance = requireMap(row, 'workflow instance')
    String instanceId = identifier(instance['instanceId'], 'workflow instanceId')
    if (workflowInstanceIdArg.isEmpty() || instanceId == workflowInstanceIdArg) matchingInstances.add(instance)
  }
}
Map instancesById = [:]
matchingInstances.each { Object value ->
  Map instance = requireMap(value, 'workflow instance')
  instancesById[identifier(instance['instanceId'], 'workflow instanceId')] = instance
}
List uniqueInstances = instancesById.values().toList()
if (uniqueInstances.size() != 1) fail('APL_INSTANCE_AMBIGUOUS', '审批实例不存在或存在歧义')
Map instance = uniqueInstances[0] as Map
String workflowInstanceId = identifier(instance['instanceId'], 'workflow instanceId')
String applicantId = identifier(instance['applicantId'], 'workflow applicantId')
if (applicantId == '-10000') fail('APL_SYSTEM_APPLICANT_REJECTED', '系统执行人不能作为业务申请人')

Object taskListEnvelopeRaw = Fx.bpm.findTaskList(workflowInstanceId, 100, 1)
Map taskListEnvelope = requireMap(taskListEnvelopeRaw, 'Fx.bpm.findTaskList')
if (taskListEnvelope['isError'] == true || taskListEnvelope['error'] == true) {
  fail('APL_TASK_LIST_READ_FAILED', '审批任务列表读取失败')
}
List taskRows = requireList(taskListEnvelope['data'], 'Fx.bpm.findTaskList.data')
List acceptedTaskStates = requireList(stage['acceptedTaskStates'], 'workflow.stage.acceptedTaskStates')
List exactTaskRows = taskRows.findAll { Object value ->
  if (!(value instanceof Map)) return false
  Map row = value as Map
  String rowTaskId = safeText(row['taskId'] ?: row['id'])
  String rowTaskName = safeText(row['taskName'] ?: row['name'])
  boolean locatorMatches = !configuredTaskId.isEmpty()
    ? rowTaskId == configuredTaskId
    : rowTaskName == configuredTaskName
  return locatorMatches && acceptedTaskStates.collect { safeText(it) }.contains(safeText(row['state']))
}
if (exactTaskRows.size() != 1) fail('APL_TASK_INSTANCE_MISMATCH', '已审核任务不属于指定审批实例或存在歧义')
Map selectedTaskRow = requireMap(exactTaskRows[0], 'Fx.bpm.findTaskList.task')
String taskId = identifier(selectedTaskRow['taskId'] ?: selectedTaskRow['id'], 'taskId')
if (!taskIdArg.isEmpty() && identifier(taskIdArg, 'taskId') != taskId) {
  fail('APL_TASK_NOT_ALLOWED', '显式任务与已审核任务不一致')
}

Object taskEnvelopeRaw = Fx.bpm.findTask(taskId, true)
Map taskEnvelope = requireMap(taskEnvelopeRaw, 'Fx.bpm.findTask')
if (taskEnvelope['isError'] == true || taskEnvelope['error'] == true) {
  fail('APL_TASK_READ_FAILED', '审批任务读取失败')
}
Map task = requireMap(taskEnvelope['data'], 'Fx.bpm.findTask.data')
if (objectApiName(task['apiName'], 'task.apiName') != workflowObjectApiName) {
  fail('APL_TASK_OBJECT_MISMATCH', '任务对象与审批对象不一致')
}
if (identifier(task['dataId'], 'task.dataId') != recordId) fail('APL_TASK_RECORD_MISMATCH', '任务记录与输入不一致')
if (identifier(task['applicantId'], 'task.applicantId') != applicantId) {
  fail('APL_TASK_APPLICANT_MISMATCH', '任务申请人与审批实例不一致')
}
if (!acceptedTaskStates.collect { safeText(it) }.contains(safeText(task['state']))) {
  fail('APL_TASK_STATE_REJECTED', '审批任务状态不允许触发寄件同步')
}

Map applicantMapping = requireMap(CONFIG['applicant'], 'applicant')
Map rootMapping = requireMap(CONFIG['rootObject'], 'rootObject')
Map detailMapping = requireMap(CONFIG['shipmentDetailObject'], 'shipmentDetailObject')
if (objectApiName(rootMapping['objectApiName'], 'rootObject.objectApiName') != workflowObjectApiName) {
  fail('APL_CONFIG_INVALID', '审批根对象映射不一致')
}

List applicantColumns = uniqueColumns([
  applicantMapping['employeeId'], applicantMapping['name'], applicantMapping['phone'],
  applicantMapping['departmentId'], applicantMapping['departmentName'],
])
Map applicantRecord = findObject(
  objectApiName(applicantMapping['objectApiName'], 'applicant.objectApiName'),
  applicantId,
  applicantColumns,
  '申请人',
)
if (mappedRequired(applicantRecord, applicantMapping['employeeId'] as Map, 'applicant.employeeId') != applicantId) {
  fail('APL_APPLICANT_MISMATCH', '申请人对象与审批申请人不一致')
}
String applicantName = requiredBoundedText(
  mappedValue(applicantRecord, applicantMapping['name'] as Map, 'applicant.name'),
  'applicant.name',
  60,
)
String applicantPhone = requiredPhone(
  mappedValue(applicantRecord, applicantMapping['phone'] as Map, 'applicant.phone'),
  'applicant.phone',
)
String applicantDepartmentName = requiredBoundedText(
  mappedValue(applicantRecord, applicantMapping['departmentName'] as Map, 'applicant.departmentName'),
  'applicant.departmentName',
  80,
)

List rootColumns = uniqueColumns([
  rootMapping['customerId'], rootMapping['customerName'], rootMapping['revisionId'],
])
Map rootRecord = findObject(workflowObjectApiName, recordId, rootColumns, '审批业务记录')

List detailColumns = uniqueColumns([
  detailMapping['parentRecordId'], detailMapping['shipment']['recipient']['name'],
  detailMapping['shipment']['recipient']['phone'], detailMapping['shipment']['recipient']['province'],
  detailMapping['shipment']['recipient']['city'], detailMapping['shipment']['recipient']['county'],
  detailMapping['shipment']['recipient']['address'], detailMapping['shipment']['cargo'],
  detailMapping['shipment']['weight'], detailMapping['shipment']['serviceId'],
  detailMapping['shipment']['servicePreference'], detailMapping['shipment']['payment'],
  detailMapping['shipment']['remark'], detailMapping['shipment']['specialRequirements'],
  detailMapping['shipment']['pickupWindow'], detailMapping['shipment']['sourceText'],
])
def findUniqueDetailId = {
  String detailApiName = objectApiName(detailMapping['objectApiName'], 'shipmentDetailObject.objectApiName')
  String parentPath = fieldApiName((detailMapping['parentRecordId'] as Map)['path'], 'shipmentDetail.parentRecordId.path')
  def (Boolean error, Object result, String message) = Fx.object.find(
    detailApiName,
    FQLAttribute.builder()
      .columns(['_id'] + detailColumns)
      .queryTemplate(QueryTemplate.AND([(parentPath): QueryOperator.EQ(recordId)]))
      .build(),
    SelectAttribute.builder().needInvalid(false).build(),
  )
  if (error == true) fail('APL_DETAIL_READ_FAILED', '寄件明细读取失败')
  Map queryResult = requireMap(result, 'Fx.object.find.data')
  List rows = requireList(queryResult['dataList'], 'Fx.object.find.dataList')
  if (safeText(queryResult['total']) != '1' || rows.size() != 1) {
    fail('APL_DETAIL_AMBIGUOUS', '审批记录必须且只能关联一条寄件明细')
  }
  Map record = requireMap(rows[0], '寄件明细')
  if (mappedRequired(record, detailMapping['parentRecordId'] as Map, 'shipmentDetail.parentRecordId') != recordId) {
    fail('APL_DETAIL_PARENT_MISMATCH', '寄件明细不属于指定审批记录')
  }
  return identifier(record['_id'], 'shipmentDetailId')
}
String shipmentDetailId = shipmentDetailIdArg.isEmpty()
  ? findUniqueDetailId()
  : identifier(shipmentDetailIdArg, 'shipmentDetailId')
Map detailRecord = findObject(
  objectApiName(detailMapping['objectApiName'], 'shipmentDetailObject.objectApiName'),
  shipmentDetailId,
  detailColumns,
  '寄件明细',
)
if (mappedRequired(detailRecord, detailMapping['parentRecordId'] as Map, 'shipmentDetail.parentRecordId') != recordId) {
  fail('APL_DETAIL_PARENT_MISMATCH', '寄件明细不属于指定审批记录')
}

Map shipmentMapping = requireMap(detailMapping['shipment'], 'shipmentDetailObject.shipment')
Map recipientMapping = requireMap(shipmentMapping['recipient'], 'shipment.recipient')
if (safeText(recipientMapping['kind']) != 'fields') {
  fail('APL_CONFIG_INVALID', '当前运维模板只允许结构化收件字段')
}
Map recipient = [
  name: requiredBoundedText(mappedValue(detailRecord, recipientMapping['name'] as Map, 'shipment.recipient.name'), 'shipment.recipient.name', 60),
  phone: requiredPhone(mappedValue(detailRecord, recipientMapping['phone'] as Map, 'shipment.recipient.phone'), 'shipment.recipient.phone'),
  province: requiredBoundedText(mappedValue(detailRecord, recipientMapping['province'] as Map, 'shipment.recipient.province'), 'shipment.recipient.province', 30),
  city: requiredBoundedText(mappedValue(detailRecord, recipientMapping['city'] as Map, 'shipment.recipient.city'), 'shipment.recipient.city', 30),
  county: requiredBoundedText(mappedValue(detailRecord, recipientMapping['county'] as Map, 'shipment.recipient.county'), 'shipment.recipient.county', 30),
  address: requiredAddress(mappedValue(detailRecord, recipientMapping['address'] as Map, 'shipment.recipient.address'), 'shipment.recipient.address'),
]

String rawWeight = mappedText(detailRecord, shipmentMapping['weight'] as Map, 'shipment.weight')
BigDecimal weight
try {
  weight = new BigDecimal(requiredText(rawWeight, 'shipment.weight'))
} catch (Exception ignored) {
  fail('APL_VALUE_INVALID', 'shipment.weight 不是有效数字')
}
if (weight <= 0G || weight > 20G) fail('APL_VALUE_INVALID', 'shipment.weight 必须大于 0 且不超过 20')

String cargo = requiredBoundedText(mappedValue(detailRecord, shipmentMapping['cargo'] as Map, 'shipment.cargo'), 'shipment.cargo', 60)
String payment = mappedText(detailRecord, shipmentMapping['payment'] as Map, 'shipment.payment') ?: 'sender_monthly'
if (!(payment in ['sender_cash', 'recipient', 'sender_monthly'])) fail('APL_VALUE_INVALID', 'shipment.payment 不受支持')
String remark = mappedText(detailRecord, shipmentMapping['remark'] as Map, 'shipment.remark')
if (remark.length() > 100) fail('APL_VALUE_INVALID', 'shipment.remark 超长')

Map shipment = [
  recipient: recipient,
  cargo: cargo,
  weight: weight,
  payment: payment,
  remark: remark,
]

if (shipmentMapping['serviceId']) {
  String rawServiceId = mappedText(detailRecord, shipmentMapping['serviceId'] as Map, 'shipment.serviceId')
  int serviceId
  try {
    serviceId = Integer.parseInt(requiredText(rawServiceId, 'shipment.serviceId'))
  } catch (NumberFormatException ignored) {
    fail('APL_VALUE_INVALID', 'shipment.serviceId 不是有效整数')
  }
  if (serviceId <= 0) fail('APL_VALUE_INVALID', 'shipment.serviceId 必须大于 0')
  shipment['serviceId'] = serviceId
}
if (shipmentMapping['servicePreference']) {
  String preference = mappedText(detailRecord, shipmentMapping['servicePreference'] as Map, 'shipment.servicePreference')
  if (!(preference in ['standard', 'urgent'])) fail('APL_VALUE_INVALID', 'shipment.servicePreference 不受支持')
  shipment['servicePreference'] = preference
}

['specialRequirements', 'pickupWindow', 'sourceText'].each { String key ->
  if (shipmentMapping[key]) {
    String optionalValue = mappedText(detailRecord, shipmentMapping[key] as Map, 'shipment.' + key)
    int maxLength = key == 'specialRequirements' ? 500 : (key == 'pickupWindow' ? 80 : 4000)
    if (optionalValue.length() > maxLength) fail('APL_VALUE_INVALID', 'shipment.' + key + ' 超长')
    if (!optionalValue.isEmpty()) shipment[key] = optionalValue
  }
}

Map payload = [
  event: [
    enterpriseId: tenantId,
    workflowInstanceId: workflowInstanceId,
    objectApiName: workflowObjectApiName,
    recordId: recordId,
    shipmentDetailId: shipmentDetailId,
    taskId: taskId,
    stageId: stageId,
    revisionId: mappedRequired(rootRecord, rootMapping['revisionId'] as Map, 'rootObject.revisionId'),
  ],
  applicant: [
    employeeId: applicantId,
    name: applicantName,
    phone: applicantPhone,
    departmentName: applicantDepartmentName,
  ],
  customer: [
    accountId: requiredBoundedText(mappedValue(rootRecord, rootMapping['customerId'] as Map, 'rootObject.customerId'), 'rootObject.customerId', 160),
    name: requiredBoundedText(mappedValue(rootRecord, rootMapping['customerName'] as Map, 'rootObject.customerName'), 'rootObject.customerName', 120),
  ],
  shipment: shipment,
]
if (applicantMapping['departmentId']) {
  String departmentId = mappedText(applicantRecord, applicantMapping['departmentId'] as Map, 'applicant.departmentId')
  if (!departmentId.isEmpty()) payload['applicant']['departmentId'] = departmentId
}

String payloadText = canonicalJson(payload)
if (payloadText.getBytes('UTF-8').length > 32768) fail('APL_REQUEST_TOO_LARGE', '规范化请求超过 ICU 大小限制')

def hmacHex = { String text ->
  byte[] digest = Fx.crypto.SHA.sha256HMAC(requiredText(CONFIG['endpoint']['clientSecret'], 'clientSecret'), text)
  String hex = safeText(Fx.crypto.hex.encode(digest)).toLowerCase()
  if (!(hex ==~ /^[a-f0-9]{64}$/)) fail('APL_SIGNATURE_INVALID', '请求签名生成失败')
  return hex
}

def callIcu = { String path, int retryCount, Boolean retryTransport, Integer expectedStatus ->
  Map endpoint = CONFIG['endpoint'] as Map
  for (int attempt = 0; attempt <= retryCount; attempt++) {
    String timestamp = Long.valueOf(System.currentTimeMillis().intdiv(1000)).toString()
    String signatureText = CANONICALIZATION + '\n' + timestamp + '\nPOST\n' + path + '\n' + payloadText
    String signature = hmacHex(signatureText)
    Request request = Request.builder()
      .method('POST')
      .url(safeText(endpoint['baseUrl']) + path)
      .timeout(Integer.valueOf(String.valueOf(endpoint['timeoutMs'])))
      .retryCount(0)
      .header('Content-Type', 'application/json')
      .header(CANONICALIZATION_HEADER, CANONICALIZATION)
      .header('x-shipping-crm-client-id', requiredText(endpoint['clientId'], 'endpoint.clientId'))
      .header('x-shipping-crm-timestamp', timestamp)
      .header('x-shipping-crm-signature', 'sha256=' + signature)
      .body(StringBody.builder().content(payload).build())
      .build()
    def (Boolean error, HttpResult result, String message) = Fx.http.execute(request)
    int statusCode = result == null ? 0 : Integer.valueOf(String.valueOf(result.statusCode))
    if (error == false && statusCode == expectedStatus.intValue()) {
      Object content = result.content
      try {
        return content instanceof String ? Fx.json.parse(content) : content
      } catch (Exception ignored) {
        fail('APL_RESPONSE_INVALID', 'ICU 返回内容不是有效 JSON')
      }
    }
    boolean retryableResponse = statusCode == 429 || statusCode >= 500
    boolean retryableTransport = error == true && retryTransport == true
    if (attempt == retryCount || (!retryableResponse && !retryableTransport)) {
      fail('APL_ICU_CALL_FAILED', 'ICU 调用失败，状态码 ' + statusCode)
    }
  }
  fail('APL_ICU_CALL_FAILED', 'ICU 调用失败')
}

Map preflight = requireMap(
  callIcu(
    safeText(CONFIG['endpoint']['preflightPath']),
    Integer.valueOf(String.valueOf(CONFIG['endpoint']['preflightRetryCount'])),
    true,
    200,
  ),
  'preflight response',
)
Map expectedEvent = payload['event'] as Map
Map responseEvent = preflight['event'] instanceof Map ? preflight['event'] as Map : [:]
['enterpriseId', 'workflowInstanceId', 'objectApiName', 'recordId', 'shipmentDetailId', 'taskId', 'stageId', 'revisionId'].each { String key ->
  if (safeText(responseEvent[key]) != safeText(expectedEvent[key])) {
    fail('APL_PREFLIGHT_EVENT_MISMATCH', 'ICU 预检返回的来源身份与请求不一致')
  }
}
String preflightEventKey = requiredText(preflight['eventKey'], 'preflight.eventKey')
if (!(preflightEventKey ==~ /^[a-f0-9]{64}$/)) fail('APL_PREFLIGHT_INVALID', 'ICU 预检 eventKey 无效')
if (!(preflight['missing'] instanceof List)) fail('APL_PREFLIGHT_INVALID', 'ICU 预检 missing 不是列表')
List missing = preflight['missing'] as List
missing.each { Object item ->
  Map missingItem = requireMap(item, 'preflight.missing[]')
  requiredBoundedText(missingItem['field'], 'preflight.missing[].field', 160)
  requiredBoundedText(missingItem['message'], 'preflight.missing[].message', 500)
  requiredBoundedText(missingItem['issue'], 'preflight.missing[].issue', 80)
}
if (!(preflight['ready'] instanceof Boolean)) fail('APL_PREFLIGHT_INVALID', 'ICU 预检 ready 无效')
if (preflight['ready'] != true || missing.size() > 0 || preflight['normalized'] == null) {
  return [status: 'preflight_blocked', eventKey: preflightEventKey, missing: missing]
}

if (safeText(CONFIG['mode']) == 'preflight') {
  return [status: 'preflight_ready', eventKey: preflightEventKey, missing: [], nextAction: 'configure_create_mode']
}

Map receipt = requireMap(
  callIcu(
    safeText(CONFIG['endpoint']['createPath']),
    Integer.valueOf(String.valueOf(CONFIG['endpoint']['createRetryCount'])),
    true,
    202,
  ),
  'create response',
)
if (receipt['accepted'] != true) fail('APL_RECEIPT_INVALID', 'ICU 未确认受理')
if (!(receipt['created'] instanceof Boolean)) fail('APL_RECEIPT_INVALID', 'ICU 创建状态无效')
if (safeText(receipt['eventKey']) != preflightEventKey) fail('APL_RECEIPT_EVENT_MISMATCH', 'ICU 受理回执与预检事件不一致')
if (safeText(receipt['status']) != 'awaiting_confirmation') fail('APL_RECEIPT_STATUS_INVALID', 'ICU 回执不是待确认状态')
if (!receipt.containsKey('waybill') || receipt['waybill'] != null) fail('APL_RECEIPT_CARRIER_STATE_INVALID', '创建待确认工单时必须明确返回空运单号')
if (safeText(receipt['nextAction']) != 'operator_confirmation') fail('APL_RECEIPT_NEXT_ACTION_INVALID', 'ICU 回执缺少人工核对下一步')
String orderId = requiredText(receipt['orderId'], 'receipt.orderId')
String orderNo = requiredBoundedText(receipt['orderNo'], 'receipt.orderNo', 80)

log.info('WP97_CRM_INTAKE_CREATED ' + preflightEventKey)
return [
  status: receipt['created'] == true ? 'created' : 'replayed',
  created: receipt['created'],
  eventKey: preflightEventKey,
  orderId: orderId,
  orderNo: orderNo,
  orderStatus: receipt['status'],
  waybill: null,
  nextAction: 'operator_confirmation',
]

// REQ: F037-F046
// PURPOSE: 配置中心 10 个报价域的表单字段规格（驱动通用 ConfigCenterTab）
export interface FieldSpec {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea' | 'json' | 'multiselect'
  options?: string[]
  required?: boolean
  placeholder?: string
}

export const DOMAIN_FIELD_SPECS: Record<string, FieldSpec[]> = {
  'business-params': [
    { key: 'param_key', label: '参数 key', type: 'text', required: true, placeholder: 'PRIVATE_MIN_SUB' },
    { key: 'name', label: '名称', type: 'text', required: true },
    { key: 'value', label: '值', type: 'json', required: true },
    { key: 'data_type', label: '类型', type: 'select', options: ['number', 'string', 'bool', 'date', 'json'] },
    { key: 'unit', label: '单位', type: 'text' },
    { key: 'category', label: '类别', type: 'select', options: ['pricing', 'approval', 'maintenance', 'gift', 'customer', 'payment', 'tax', 'quote'] },
    { key: 'is_secret', label: '敏感', type: 'boolean' },
    { key: 'description', label: '说明', type: 'textarea' },
  ],
  'field-dictionary': [
    { key: 'field_key', label: '字段 key', type: 'text', required: true, placeholder: 'grand_total' },
    { key: 'business_name', label: '业务名称', type: 'text', required: true },
    { key: 'source', label: '来源', type: 'select', options: ['system', 'input', 'config', 'computed'] },
    { key: 'transform_rule', label: '转换规则', type: 'select', options: ['direct', 'formula', 'semantic', 'conditional', 'capture'] },
    { key: 'output_classification', label: '输出分类', type: 'select', options: ['header', 'software', 'financial', 'clause', 'internal'] },
    { key: 'is_external', label: '对外输出', type: 'boolean' },
    { key: 'data_type', label: '数据类型', type: 'select', options: ['string', 'number', 'date', 'bool', 'enum', 'json'] },
    { key: 'options', label: '枚举选项', type: 'json' },
    { key: 'remark', label: '备注', type: 'textarea' },
  ],
  'numbering-rules': [
    { key: 'doc_type', label: '单据类型', type: 'text', placeholder: 'quote' },
    { key: 'prefix', label: '前缀', type: 'text', placeholder: 'QT-' },
    { key: 'date_format', label: '日期格式', type: 'text', placeholder: 'YYYYMMDD' },
    { key: 'seq_start', label: '起始流水', type: 'number' },
    { key: 'padding', label: '流水位数', type: 'number' },
    { key: 'suffix', label: '后缀', type: 'text' },
    { key: 'separator', label: '分隔符', type: 'text' },
    { key: 'sample', label: '示例', type: 'text' },
    { key: 'enabled', label: '启用', type: 'boolean' },
  ],
  'product-versions': [
    { key: 'version_code', label: '版本编码', type: 'text', required: true, placeholder: 'ENT_V6' },
    { key: 'name', label: '版本名称', type: 'text', required: true },
    { key: 'deployments', label: '部署方式', type: 'multiselect', options: ['PUBLIC_CLOUD', 'PRIVATE', 'HA'] },
    { key: 'auth_modes', label: '授权方式', type: 'multiselect', options: ['SUB_YEAR', 'SUB_3YEAR', 'ONETIME'] },
    { key: 'capabilities', label: '能力标签', type: 'json', placeholder: '{"ha":true,"xinchuang":true,"onetime":true}' },
    { key: 'mutex', label: '互斥', type: 'json' },
  ],
  'price-matrix': [
    { key: 'product_id', label: '产品 ID', type: 'text', required: true },
    { key: 'version_code', label: '版本', type: 'text', required: true, placeholder: 'ENT_V6' },
    { key: 'deployment', label: '部署', type: 'select', options: ['PUBLIC_CLOUD', 'PRIVATE', 'HA'] },
    { key: 'auth_mode', label: '授权', type: 'select', options: ['SUB_YEAR', 'SUB_3YEAR', 'ONETIME'] },
    { key: 'term_months', label: '期限（月，买断留空）', type: 'number' },
    { key: 'currency', label: '币种', type: 'text', placeholder: 'CNY' },
    { key: 'qty_from', label: '区间下限', type: 'number', required: true },
    { key: 'qty_to', label: '区间上限（10,000+ 留空）', type: 'number' },
    { key: 'unit_price', label: '区间单账号价', type: 'number' },
    { key: 'list_price', label: '累计刊例价', type: 'number' },
    { key: 'sort_order', label: '排序', type: 'number' },
  ],
  'approval-chains': [
    { key: 'code', label: '编码', type: 'text', required: true },
    { key: 'name', label: '名称', type: 'text', required: true },
    { key: 'mode', label: '模式', type: 'select', options: ['serial', 'parallel'] },
    { key: 'quorum', label: '收口', type: 'select', options: ['all', 'any'] },
    { key: 'nodes', label: '节点（JSON 数组）', type: 'json', placeholder: '[{"ord":1,"assignee_type":"role","assignee_value":"ROLE_REGION_LEAD"}]' },
  ],
  'approval-rules': [
    { key: 'code', label: '编码', type: 'text', required: true },
    { key: 'scene', label: '场景', type: 'select', options: ['QUOTE_DISCOUNT', 'MAINT_DISCOUNT', 'UPGRADE_DISCOUNT'] },
    { key: 'condition', label: '条件', type: 'json', placeholder: '{"discount":{"gte":50,"lt":100}}' },
    { key: 'chain_id', label: '审批链 ID', type: 'text', required: true },
    { key: 'priority', label: '优先级', type: 'number' },
    { key: 'enabled', label: '启用', type: 'boolean' },
  ],
  'clause-mappings': [
    { key: 'code', label: '编码', type: 'text', required: true },
    { key: 'match', label: '匹配条件', type: 'json', placeholder: '{"version":"ENT_V6","period":"SUB_YEAR"}' },
    { key: 'clause_code', label: '条款编码', type: 'text', required: true },
    { key: 'clause_text', label: '条款文本', type: 'textarea' },
    { key: 'template_ref', label: '模板引用', type: 'text' },
    { key: 'required', label: '必填', type: 'boolean' },
    { key: 'sort_order', label: '排序', type: 'number' },
  ],
  'output-templates': [
    { key: 'code', label: '编码', type: 'text', required: true },
    { key: 'name', label: '名称', type: 'text', required: true },
    { key: 'doc_type', label: '类型', type: 'select', options: ['standard', 'customer'] },
    { key: 'scene', label: '场景', type: 'text' },
    { key: 'match_rule', label: '匹配规则', type: 'json', placeholder: '{"v_type":"subscription"}' },
    { key: 'variables', label: '变量（字段 key 数组）', type: 'json', placeholder: '["grand_total","total_in_words"]' },
    { key: 'content_ref', label: '模板文件引用', type: 'text' },
  ],
}

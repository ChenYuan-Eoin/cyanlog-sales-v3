// DEV ONLY: exercises the real generated Groovy source with simulated Fxiaoke APIs.
// HTTP is sent to the local ICU dev server. This is not a Fxiaoke compiler attestation.
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class TestBuilder {
  Map values = [:]
  Class resultType
  Object methodMissing(String name, Object raw) {
    Object[] args = raw as Object[]
    if (name == 'header') {
      if (!values.headers) values.headers = [:]
      values.headers[args[0]] = args[1]
    } else values[name] = args[0]
    return this
  }
  Object build() {
    if (resultType) { def result = resultType.newInstance(); result.putAll(values); return result }
    return values
  }
}
class FQLAttribute { static TestBuilder builder() { new TestBuilder() } }
class SelectAttribute { static TestBuilder builder() { new TestBuilder() } }
class StringBody { static TestBuilder builder() { new TestBuilder() } }
class Request extends LinkedHashMap { static TestBuilder builder() { new TestBuilder(resultType: Request) } }
class QueryTemplate { static Object AND(Object value) { value } }
class QueryOperator { static Object EQ(Object value) { value } }
class HttpResult { int statusCode; Object content }

Map fixture = new JsonSlurper().parse(new File(args[1])) as Map
Map config = fixture.config as Map
Map records = fixture.records as Map
List calls = []
def fx = [
  json: [parse: { String value -> new JsonSlurper().parseText(value) }],
  message: [throwException: { String value -> throw new IllegalStateException(value) }],
  bpm: [
    findInstances: { Object api, Object state, Object id, Object size, Object page ->
      [isError: false, data: [QueryResult: [total: state == 'in_progress' ? 1 : 0, dateList: state == 'in_progress' ? [[instanceId: fixture.instanceId, applicantId: 'dev-employee', state: 'in_progress']] : []]]]
    },
    findTaskList: { Object id, Object size, Object page ->
      [isError: false, data: [[taskId: fixture.taskId, taskName: config.workflow.stages[0].taskName, state: 'pass']]]
    },
    findTask: { Object id, Object notGetData ->
      [isError: false, data: [apiName: config.workflow.objectApiName, dataId: fixture.recordId, applicantId: 'dev-employee', state: 'pass']]
    },
  ],
  object: [
    findById: { Object api, Object id, Object query, Object attr -> [false, records[api + ':' + id], ''] },
    find: { Object api, Object query, Object attr -> [false, [total: 1, dataList: [records[api + ':' + fixture.detailId]]], ''] },
  ],
  crypto: [
    SHA: [sha256HMAC: { String key, String value ->
      Mac mac = Mac.getInstance('HmacSHA256')
      mac.init(new SecretKeySpec(key.getBytes('UTF-8'), 'HmacSHA256'))
      mac.doFinal(value.getBytes('UTF-8'))
    }],
    hex: [encode: { byte[] bytes -> bytes.encodeHex().toString() }],
  ],
  http: [execute: { Map request ->
    String path = new URI(request.url as String).path
    String local = System.getenv('ICU_DEV_URL')
    if (!(local ==~ /^http:\/\/127\.0\.0\.1:[0-9]+$/)) throw new IllegalStateException('local dev URL required')
    HttpURLConnection conn = new URL(local + path).openConnection() as HttpURLConnection
    conn.requestMethod = request.method
    conn.connectTimeout = 15000; conn.readTimeout = 30000; conn.doOutput = true
    request.headers.each { key, value -> conn.setRequestProperty(key as String, value as String) }
    conn.outputStream.withCloseable { it.write(JsonOutput.toJson(request.body.content).getBytes('UTF-8')) }
    int status = conn.responseCode
    String content = (status >= 400 ? conn.errorStream : conn.inputStream)?.getText('UTF-8')
    calls.add([path: path, status: status])
    return [false, new HttpResult(statusCode: status, content: content), '']
  }],
]
Binding binding = new Binding([
  Fx: fx,
  context: [data: [_id: fixture.recordId, object_describe_api_name: config.workflow.objectApiName], tenantId: fixture.contextTenant ?: config.enterpriseId, arg: null],
  log: [info: { Object value -> }],
])
GroovyShell shell = new GroovyShell(this.class.classLoader, binding)
try {
  Object result = shell.evaluate(new File(args[0]))
  println(JsonOutput.toJson([result: result, calls: calls]))
} catch (Exception e) {
  println(JsonOutput.toJson([error: e.message, calls: calls]))
  System.exit(1)
}

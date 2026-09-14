import { createHash } from 'node:crypto'
import { savedContactSchema, contactSchema } from './validation'
export type AddressSource = { name: string; phone: string; rawAddress: string; company: string; batch: string; row: number }
// Preserve the source verbatim in metadata. Only explicit region prefixes are split.
export function prepareAddressImport(source: AddressSource) {
  let rest = source.rawAddress.trim()
  let province='', city='', county=''
  const p=rest.match(/^(北京市|上海市|天津市|重庆市|内蒙古自治区|广西壮族自治区|西藏自治区|宁夏回族自治区|新疆维吾尔自治区|[\u4e00-\u9fff]{2,3}省)/)
  if(p){province=p[1];rest=rest.slice(province.length);if(/^(北京|上海|天津|重庆)市$/.test(province)){city=province;if(rest.startsWith(city))rest=rest.slice(city.length)}else{const c=rest.match(/^([^\s]{2,12}?(?:市|自治州|地区|盟))/);if(c){city=c[1];rest=rest.slice(city.length)}}
    if(city){const c=rest.match(/^([^\s]{2,12}?(?:区|县|旗|市))/);if(c){county=c[1];rest=rest.slice(county.length)}}}
  const contact=savedContactSchema.parse({name:source.name.trim(),phone:source.phone.trim(),province,city,county,address:rest})
  const fingerprint=createHash('sha256').update(JSON.stringify(contact)).digest('hex')
  return {label:('顺丰导入 · '+source.name).slice(0,40),fingerprint,contact:{...contact,_source:{provider:'sf-express',mode:'one_time_export',rawAddress:source.rawAddress,company:source.company,batch:source.batch,row:source.row}},needsReview:!contactSchema.safeParse(contact).success}
}

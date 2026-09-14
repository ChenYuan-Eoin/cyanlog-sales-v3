import { describe,it,expect } from 'vitest'
import { prepareAddressImport } from './import-contacts'
const source={name:'测试',phone:'13800000000',rawAddress:'上海市上海市浦东新区测试路100号',company:'示例公司',batch:'batch-01.xlsx',row:2}
describe('SF exported address import',()=>{
 it('preserves original source and splits repeated municipality prefix',()=>{const r=prepareAddressImport(source);expect(r.contact).toMatchObject({province:'上海市',city:'上海市',county:'浦东新区',address:'测试路100号',_source:{rawAddress:source.rawAddress,company:'示例公司'}});expect(r.needsReview).toBe(false)})
 it('retains incomplete original address without inventing missing regions',()=>{const r=prepareAddressImport({...source,rawAddress:'测试路100号'});expect(r.contact.address).toBe('测试路100号');expect(r.contact.city).toBe('');expect(r.needsReview).toBe(true)})
 it('deduplicates across export batches',()=>expect(prepareAddressImport(source).fingerprint).toBe(prepareAddressImport({...source,batch:'batch-02.xlsx',row:8}).fingerprint))
})

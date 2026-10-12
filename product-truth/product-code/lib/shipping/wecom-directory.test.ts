import { expect, it } from 'vitest'
import { authorizedDepartmentIds, memberMatchesDepartments, normalizeWecomDirectory } from './wecom-directory'
const departments = [{id:1,parentid:0,name:'企业'},{id:2,parentid:1,name:'销售'},{id:3,parentid:2,name:'华南组'},{id:4,parentid:1,name:'华南组'}]
const member = {userid:'staff',name:'员工',mobile:'13800000000',department:[3],status:1}
it('preserves IDs and hierarchy even when department names are identical',()=>{
 const d=normalizeWecomDirectory(departments,[member]);expect(d.departments[2]).toMatchObject({id:3,parentId:2,name:'华南组'});expect(d.members[0].departmentIds).toEqual([3]);expect(authorizedDepartmentIds(d.departments,[2])).toEqual([2,3]);expect(memberMatchesDepartments(d.members[0],[2,3])).toBe(true)
})
it('does not authorize a sibling or a deactivated employee',()=>{
 const d=normalizeWecomDirectory(departments,[member]);expect(memberMatchesDepartments(d.members[0],[4])).toBe(false);expect(memberMatchesDepartments({...d.members[0],active:false},[3])).toBe(false);expect(authorizedDepartmentIds(d.departments,[])).toEqual([])
})
it('fails closed on cycles, duplicate IDs and stale selections',()=>{
 expect(()=>normalizeWecomDirectory([...departments,{id:2,parentid:0,name:'重复'}],[member])).toThrow('组织数据')
 expect(()=>normalizeWecomDirectory([{id:1,parentid:2,name:'A'},{id:2,parentid:1,name:'B'}],[member])).toThrow('组织数据')
 expect(()=>authorizedDepartmentIds(normalizeWecomDirectory(departments,[member]).departments,[999])).toThrow('部门已变化')
})
it('keeps a visible subtree without inventing an inaccessible parent',()=>{
 const d=normalizeWecomDirectory([{id:3,parentid:2,name:'可见部门'}],[member]);expect(d.departments).toEqual([{id:3,parentId:2,name:'可见部门',order:0}]);expect(authorizedDepartmentIds(d.departments,[3])).toEqual([3])
})

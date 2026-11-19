import type { Contact } from '@/lib/shipping/types'
import styles from './workspace.module.css'

export default function ContactFields({ title, mark, value, onChange, disabled }: { title: string; mark: string; value: Contact; onChange: (v: Contact) => void; disabled: boolean }) {
  const input = (key: keyof Contact, label: string, placeholder: string, max = 60) => <label className={styles.field}><span>{label}</span><input aria-label={`${title}${label}`} required maxLength={max} value={value[key]} placeholder={placeholder} autoComplete="off" onChange={e => onChange({ ...value, [key]: e.target.value })} /></label>
  return <fieldset disabled={disabled} className={styles.contact}><legend><b className={mark === '收' ? styles.receiveMark : styles.sendMark}>{mark}</b>{title}</legend><div className={styles.two}>{input('name', '姓名', '姓名或公司联系人')}{input('phone', '联系电话', '手机号 / 座机', 30)}</div><div className={styles.three}>{input('province', '省份', '省 / 直辖市', 30)}{input('city', '城市', '城市', 30)}{input('county', '区县', '区 / 县', 30)}</div>{input('address', '详细地址', '街道、楼宇及门牌号', 200)}</fieldset>
}

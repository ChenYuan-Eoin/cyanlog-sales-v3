'use client'

import { CarrierChanges, type CarrierChangesProps } from '../shipping/carrier-changes'

export function OwnerCarrierChanges(props: Omit<CarrierChangesProps, 'endpoint'>) {
  const endpoint = '/api/shipping/owner/orders/' + encodeURIComponent(props.orderNo) + '/carrier-changes'
  return <CarrierChanges {...props} endpoint={endpoint} />
}

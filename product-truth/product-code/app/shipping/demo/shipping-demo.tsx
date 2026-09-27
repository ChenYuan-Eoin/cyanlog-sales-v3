'use client'

import { useState } from 'react'
import ShippingWorkbench from '../workbench'
import { createShippingSimulation, shippingExampleText, shippingSimulationSettings } from '@/lib/shipping/simulation'

function DemoSession({ onReset }: { onReset: () => void }) {
  const [request] = useState(() => createShippingSimulation())
  return <ShippingWorkbench settings={shippingSimulationSettings} simulation={{ request, sampleText: shippingExampleText, onReset }} />
}

export default function ShippingDemo() {
  const [version, setVersion] = useState(0)
  return <DemoSession key={version} onReset={() => setVersion(value => value + 1)} />
}

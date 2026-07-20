'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import type { Config } from '../types'
import ConfigStatusBadge from '../tabs/ConfigStatusBadge'

interface ConfigVersionRecord {
  version: number
  status: string
  created_at: string
}

interface ConfigVersionDialogProps {
  open: boolean
  versions: ConfigVersionRecord[]
  versionConfigId: string | null
  onOpenChange: (open: boolean) => void
  onRollback: (configId: string, version: number) => void | Promise<void>
}

export default function ConfigVersionDialog({
  open,
  versions,
  versionConfigId,
  onOpenChange,
  onRollback,
}: ConfigVersionDialogProps) {
  function requestRollback(configId: string, version: number) {
    // The shared confirmation dialog is rendered in a separate portal. Close
    // this modal first so its overlay cannot sit above and intercept the
    // confirmation action. The next animation frame guarantees the close has
    // reached the DOM before opening the confirmation dialog.
    onOpenChange(false)
    window.requestAnimationFrame(() => {
      void onRollback(configId, version)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>版本历史</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {versions.length === 0 ? (
            <p className="text-center text-slate-500">暂无版本历史</p>
          ) : (
            <div className="space-y-2">
              {versions.map((version) => (
                <div key={version.version} className="flex items-center justify-between p-3 bg-slate-50 rounded">
                  <div>
                    <div className="font-medium">版本 {version.version}</div>
                    <div className="text-xs text-slate-500">{new Date(version.created_at).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ConfigStatusBadge status={version.status as Config['status']} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => versionConfigId && requestRollback(versionConfigId, version.version)}
                    >
                      回滚
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

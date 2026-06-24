'use client'

// Notion风格Blocks编辑器 - 知识库富文本编辑器(P2-3)
// 支持标题、段落、列表、代码块、引用、分割线等

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  CodeIcon,
  MinusIcon,
  Trash2Icon,
  GripVerticalIcon,
  PlusIcon,
} from 'lucide-react'

// Block 类型
export type BlockType =
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'paragraph'
  | 'bulleted_list'
  | 'numbered_list'
  | 'quote'
  | 'code'
  | 'divider'

export interface Block {
  id: string
  type: BlockType
  content: string
  language?: string  // for code block
}

interface NotionEditorProps {
  initialBlocks?: Block[]
  onChange?: (blocks: Block[]) => void
  readOnly?: boolean
}

const BLOCK_CONFIG: Record<BlockType, { label: string; icon: typeof Heading1Icon }> = {
  heading_1: { label: '一级标题', icon: Heading1Icon },
  heading_2: { label: '二级标题', icon: Heading2Icon },
  heading_3: { label: '三级标题', icon: Heading3Icon },
  paragraph: { label: '段落', icon: GripVerticalIcon },
  bulleted_list: { label: '无序列表', icon: ListIcon },
  numbered_list: { label: '有序列表', icon: ListOrderedIcon },
  quote: { label: '引用', icon: QuoteIcon },
  code: { label: '代码块', icon: CodeIcon },
  divider: { label: '分割线', icon: MinusIcon },
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

export default function NotionEditor({ initialBlocks = [], onChange, readOnly = false }: NotionEditorProps) {
  const [blocks, setBlocks] = useState<Block[]>(
    initialBlocks.length > 0
      ? initialBlocks
      : [{ id: generateId(), type: 'paragraph', content: '' }]
  )
  const blockRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    if (initialBlocks.length > 0 && blocks === initialBlocks) return
    onChange?.(blocks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, onChange])

  const updateBlock = useCallback((id: string, updates: Partial<Block>) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...updates } : b))
    )
  }, [])

  const addBlock = useCallback(
    (type: BlockType, afterId?: string) => {
      const newBlock: Block = {
        id: generateId(),
        type,
        content: '',
        language: type === 'code' ? 'typescript' : undefined,
      }
      setBlocks((prev) => {
        const idx = afterId ? prev.findIndex((b) => b.id === afterId) : prev.length - 1
        const newBlocks = [...prev]
        newBlocks.splice(idx + 1, 0, newBlock)
        return newBlocks
      })
      // Focus on new block after render
      setTimeout(() => {
        const el = blockRefs.current.get(newBlock.id)
        if (el) {
          const editable = el.querySelector<HTMLElement>('[contenteditable]')
          editable?.focus()
        }
      }, 0)
    },
    []
  )

  const removeBlock = useCallback((id: string) => {
    setBlocks((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((b) => b.id !== id)
    })
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, blockId: string) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        addBlock('paragraph', blockId)
      }
    },
    [addBlock]
  )

  if (readOnly) {
    return (
      <div className="space-y-2">
        {blocks.map((block) => (
          <BlockRenderer key={block.id} block={block} readOnly />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* 工具栏 */}
      <div className="flex flex-wrap gap-1 p-2 bg-slate-50 rounded-lg border border-slate-200 sticky top-0 z-10">
        {Object.entries(BLOCK_CONFIG).map(([type, config]) => {
          const Icon = config.icon
          return (
            <Button
              key={type}
              variant="ghost"
              size="sm"
              title={config.label}
              onClick={() => addBlock(type as BlockType)}
              className="h-8 w-8 p-0"
            >
              <Icon size={16} className="text-slate-600" />
            </Button>
          )
        })}
      </div>

      {/* Blocks */}
      <div className="space-y-1">
        {blocks.map((block, _index) => (
          <div
            key={block.id}
            ref={(el) => {
              if (el) blockRefs.current.set(block.id, el)
            }}
            className="group flex items-start gap-2 rounded-lg hover:bg-slate-50/50 transition-colors"
          >
            {/* 拖动手柄 */}
            <div className="pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <GripVerticalIcon size={14} className="text-slate-300 cursor-grab" />
            </div>

            {/* Block 内容 */}
            <div className="flex-1 min-w-0">
              <BlockRenderer
                block={block}
                onChange={(content) => updateBlock(block.id, { content })}
                onKeyDown={(e) => handleKeyDown(e, block.id)}
              />
            </div>

            {/* 删除按钮 */}
            {blocks.length > 1 && (
              <button
                onClick={() => removeBlock(block.id)}
                className="pt-2 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-red-500"
              >
                <Trash2Icon size={14} />
              </button>
            )}

            {/* 添加按钮 */}
            <div className="pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => addBlock('paragraph', block.id)}
                className="text-slate-400 hover:text-blue-500"
              >
                <PlusIcon size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Block 渲染器
function BlockRenderer({
  block,
  onChange,
  onKeyDown,
  readOnly = false,
}: {
  block: Block
  onChange?: (content: string) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  readOnly?: boolean
}) {
  const handleInput = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      if (readOnly) return
      onChange?.(e.currentTarget.innerText)
    },
    [onChange, readOnly]
  )

  const commonProps: Record<string, unknown> = {
    onInput: handleInput,
    onKeyDown,
    contentEditable: !readOnly,
    suppressContentEditableWarning: true,
    className: 'outline-none focus-visible:ring-2 focus-visible:ring-blue-200 rounded px-1',
    'data-placeholder': '输入内容...',
  }

  switch (block.type) {
    case 'heading_1':
      return (
        <h1 {...commonProps} className="text-3xl font-bold text-slate-900 mb-4 mt-6">
          {block.content || (!readOnly ? '' : '')}
        </h1>
      )
    case 'heading_2':
      return (
        <h2 {...commonProps} className="text-2xl font-semibold text-slate-900 mb-3 mt-5">
          {block.content || (!readOnly ? '' : '')}
        </h2>
      )
    case 'heading_3':
      return (
        <h3 {...commonProps} className="text-lg font-semibold text-slate-900 mb-2 mt-4">
          {block.content || (!readOnly ? '' : '')}
        </h3>
      )
    case 'quote':
      return (
        <blockquote className="border-l-4 border-blue-400 pl-4 py-1 my-2 text-slate-700 italic">
          <div {...commonProps}>{block.content || (!readOnly ? '' : '')}</div>
        </blockquote>
      )
    case 'code':
      return (
        <div className="bg-slate-900 text-slate-100 rounded-lg p-4 my-2 font-mono text-sm overflow-x-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">{block.language || 'code'}</span>
          </div>
          <pre {...commonProps} className="outline-none">
            {block.content || (!readOnly ? '' : '')}
          </pre>
        </div>
      )
    case 'divider':
      return <hr className="border-slate-200 my-4" />
    case 'bulleted_list':
      return (
        <li className="flex items-start gap-2 ml-4 my-1">
          <span className="text-slate-400 mt-1">•</span>
          <div {...commonProps} className="flex-1 outline-none">{block.content || (!readOnly ? '' : '')}</div>
        </li>
      )
    case 'numbered_list':
      return (
        <li className="flex items-start gap-2 ml-4 my-1">
          <span className="text-slate-400 mt-1 text-sm font-mono">{block.id.slice(0, 2)}.</span>
          <div {...commonProps} className="flex-1 outline-none">{block.content || (!readOnly ? '' : '')}</div>
        </li>
      )
    case 'paragraph':
    default:
      return (
        <div {...commonProps} className="text-slate-800 leading-relaxed my-1">
          {block.content || (!readOnly ? '' : '')}
        </div>
      )
  }
}

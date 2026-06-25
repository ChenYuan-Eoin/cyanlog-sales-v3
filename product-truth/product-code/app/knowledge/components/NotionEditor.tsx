// Notion风格富文本编辑器 - Blocks 系统
// 支持：heading / paragraph / list / table / code / callout / quote / divider / embed

'use client'

import { useState, useCallback } from 'react'
import {
  Heading2Icon,
  TypeIcon,
  ListIcon,
  ListOrderedIcon,
  TableIcon,
  CodeIcon,
  MessageSquareIcon,
  QuoteIcon,
  MinusIcon,
  PlusIcon,
  GripVerticalIcon,
  TrashIcon,
} from 'lucide-react'

// Block 类型定义
export interface Block {
  id: string
  type: 'heading' | 'paragraph' | 'bulleted_list' | 'numbered_list' | 'table' | 'code' | 'callout' | 'quote' | 'divider' | 'embed'
  content: string
  level?: number
  items?: string[]
  language?: string
  emoji?: string
  url?: string
  tableData?: { headers: string[]; rows: string[][] }
}

// 生成唯一ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 10)
}

// 默认blocks
function createDefaultBlocks(): Block[] {
  return [
    {
      id: generateId(),
      type: 'heading',
      content: '新页面',
      level: 1,
    },
    {
      id: generateId(),
      type: 'paragraph',
      content: '',
    },
  ]
}

// 创建新block
function createBlock(type: Block['type']): Block {
  const base: Block = {
    id: generateId(),
    type,
    content: '',
  }

  switch (type) {
    case 'heading':
      return { ...base, level: 2 }
    case 'code':
      return { ...base, language: 'javascript' }
    case 'callout':
      return { ...base, emoji: '💡' }
    case 'table':
      return { ...base, tableData: { headers: ['列1', '列2'], rows: [['', '']] } }
    default:
      return base
  }
}

// 单个Block组件
function BlockEditor({
  block,
  onChange,
  onDelete,
  onAddBelow: _onAddBelow,
}: {
  block: Block
  onChange: (id: string, updates: Partial<Block>) => void
  onDelete: (id: string) => void
  onAddBelow: () => void
}) {

  const handleContentChange = (e: React.FocusEvent<Element>) => {
    onChange(block.id, { content: e.currentTarget.textContent || '' })
  }

  const renderBlockContent = () => {
    switch (block.type) {
      case 'heading':
        const headingClasses: Record<number, string> = {
          1: 'text-3xl font-bold mb-4',
          2: 'text-2xl font-semibold mb-3',
          3: 'text-xl font-medium mb-2',
        }
        const headingClass = headingClasses[block.level || 2] || headingClasses[2]
        const level = block.level || 2
        const HeadingTag = level === 1 ? 'h1' : level === 3 ? 'h3' : 'h2'
        const Tag = HeadingTag as keyof JSX.IntrinsicElements
        return (
          <Tag
            className={`${headingClass} outline-none`}
            contentEditable
            suppressContentEditableWarning
            onBlur={handleContentChange}
            defaultValue={block.content}
            dangerouslySetInnerHTML={{ __html: block.content }}
          />
        )

      case 'paragraph':
        return (
          <p
            className="text-base text-slate-700 leading-relaxed mb-4 outline-none min-h-[1.5em]"
            contentEditable
            suppressContentEditableWarning
            onBlur={handleContentChange}
            dangerouslySetInnerHTML={{ __html: block.content || '<br>' }}
          />
        )

      case 'bulleted_list':
        return (
          <ul className="list-disc list-inside mb-4 space-y-1">
            <li>
              <span
                className="text-base text-slate-700 outline-none"
                contentEditable
                suppressContentEditableWarning
                onBlur={handleContentChange}
                dangerouslySetInnerHTML={{ __html: block.content }}
              />
            </li>
          </ul>
        )

      case 'numbered_list':
        return (
          <ol className="list-decimal list-inside mb-4 space-y-1">
            <li>
              <span
                className="text-base text-slate-700 outline-none"
                contentEditable
                suppressContentEditableWarning
                onBlur={handleContentChange}
                dangerouslySetInnerHTML={{ __html: block.content }}
              />
            </li>
          </ol>
        )

      case 'code':
        return (
          <div className="mb-4">
            <div className="flex items-center gap-2 bg-slate-800 text-slate-300 px-3 py-1 rounded-t-lg text-xs">
              <CodeIcon size={14} />
              <span>{block.language || 'javascript'}</span>
            </div>
            <pre className="bg-slate-900 text-slate-300 p-4 rounded-b-lg overflow-x-auto">
              <code
                className="text-sm font-mono outline-none block min-h-[2em]"
                contentEditable
                suppressContentEditableWarning
                onBlur={handleContentChange}
                dangerouslySetInnerHTML={{ __html: block.content }}
              />
            </pre>
          </div>
        )

      case 'callout':
        return (
          <div className="flex gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4">
            <span className="text-lg shrink-0">{block.emoji || '💡'}</span>
            <div
              className="flex-1 text-sm text-slate-700 outline-none"
              contentEditable
              suppressContentEditableWarning
              onBlur={handleContentChange}
              dangerouslySetInnerHTML={{ __html: block.content }}
            />
          </div>
        )

      case 'quote':
        return (
          <blockquote className="border-l-4 border-slate-300 pl-4 py-2 mb-4 text-slate-600 italic">
            <div
              className="outline-none"
              contentEditable
              suppressContentEditableWarning
              onBlur={handleContentChange}
              dangerouslySetInnerHTML={{ __html: block.content }}
            />
          </blockquote>
        )

      case 'divider':
        return <hr className="my-6 border-t border-slate-200" />

      case 'table':
        return (
          <div className="mb-4 overflow-x-auto">
            <table className="w-full border-collapse border border-slate-200 rounded-lg">
              <thead>
                <tr>
                  {block.tableData?.headers.map((header, i) => (
                    <th key={i} className="border border-slate-200 px-3 py-2 bg-slate-50 text-sm font-medium text-slate-700 text-left">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.tableData?.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="border border-slate-200 px-3 py-2 text-sm text-slate-600">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="group relative flex gap-2">
      {/* 拖拽手柄 */}
      <div className="flex flex-col items-center pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVerticalIcon size={16} className="text-slate-300 cursor-grab" />
      </div>

      {/* 内容 */}
      <div className="flex-1">
        {renderBlockContent()}
      </div>

      {/* 操作按钮（hover显示） */}
      <div className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
        <button
          onClick={() => onDelete(block.id)}
          className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-red-500"
          title="删除"
        >
          <TrashIcon size={14} />
        </button>
      </div>
    </div>
  )
}

// 添加Block工具栏
function AddBlockToolbar({ onAdd }: { onAdd: (type: Block['type']) => void }) {
  const [isOpen, setIsOpen] = useState(false)

  const tools = [
    { type: 'heading' as const, icon: Heading2Icon, label: '标题' },
    { type: 'paragraph' as const, icon: TypeIcon, label: '段落' },
    { type: 'bulleted_list' as const, icon: ListIcon, label: '无序列表' },
    { type: 'numbered_list' as const, icon: ListOrderedIcon, label: '有序列表' },
    { type: 'code' as const, icon: CodeIcon, label: '代码块' },
    { type: 'callout' as const, icon: MessageSquareIcon, label: '提示框' },
    { type: 'quote' as const, icon: QuoteIcon, label: '引用' },
    { type: 'divider' as const, icon: MinusIcon, label: '分隔线' },
    { type: 'table' as const, icon: TableIcon, label: '表格' },
  ]

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
      >
        <PlusIcon size={14} />
        <span>添加 Block</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 bg-white border border-slate-200 rounded-lg shadow-lg p-2 grid grid-cols-3 gap-1 z-50">
          {tools.map(tool => (
            <button
              key={tool.type}
              onClick={() => {
                onAdd(tool.type)
                setIsOpen(false)
              }}
              className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-slate-50 transition text-center"
            >
              <tool.icon size={20} className="text-slate-500" />
              <span className="text-xs text-slate-600">{tool.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// 主编辑器组件
interface NotionEditorProps {
  initialBlocks?: Block[]
  onChange?: (blocks: Block[]) => void
  readOnly?: boolean
}

export default function NotionEditor({ initialBlocks, onChange, readOnly = false }: NotionEditorProps) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks || createDefaultBlocks())

  const handleChange = useCallback((id: string, updates: Partial<Block>) => {
    setBlocks(prev => {
      const updated = prev.map(block =>
        block.id === id ? { ...block, ...updates } : block
      )
      onChange?.(updated)
      return updated
    })
  }, [onChange])

  const handleDelete = useCallback((id: string) => {
    setBlocks(prev => {
      const updated = prev.filter(block => block.id !== id)
      onChange?.(updated)
      return updated
    })
  }, [onChange])

  const handleAddBelow = useCallback((type: Block['type']) => {
    setBlocks(prev => {
      const updated = [...prev, createBlock(type)]
      onChange?.(updated)
      return updated
    })
  }, [onChange])

  return (
    <div className="max-w-3xl mx-auto py-8">
      {/* Block列表 */}
      <div className="space-y-1">
        {blocks.map((block) => (
          <BlockEditor
            key={block.id}
            block={block}
            onChange={handleChange}
            onDelete={handleDelete}
            onAddBelow={() => {}}
          />
        ))}
      </div>

      {/* 添加Block工具 */}
      {!readOnly && (
        <div className="mt-6 pt-4 border-t border-slate-100">
          <AddBlockToolbar onAdd={handleAddBelow} />
        </div>
      )}
    </div>
  )
}

// 导出工具函数
export { generateId }
// Block 类型已在文件顶部通过 export interface Block 导出

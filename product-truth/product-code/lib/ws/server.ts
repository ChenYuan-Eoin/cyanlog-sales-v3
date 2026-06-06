// lib/ws/server.ts
// WebSocket服务 — 房间管理 + 消息广播
// WebSocket是双向通信，适合实时协作场景
// 多人同时审核合同时，AI审核结果要实时推送给所有参与者

/**
 * 简化的WebSocket接口（不依赖ws包）
 * 实际应用应使用: import type { WebSocket } from 'ws'
 */
export interface WSConnection {
  readyState: number
  send(data: string): void
  on(event: string, listener: (...args: unknown[]) => void): void
}

/**
 * 房间 — 按合同ID分组
 */
export interface WSRoom {
  /** 房间ID（通常是合同ID） */
  id: string
  /** 房间内的连接 */
  connections: Set<WSConnection>
  /** 创建时间 */
  createdAt: number
}

/**
 * 消息类型
 */
export type WSMessageType = 'join' | 'leave' | 'broadcast' | 'ai_progress' | 'ask_update' | 'ping' | 'pong'

/**
 * 消息结构
 */
export interface WSMessage {
  type: WSMessageType
  /** 房间ID */
  room?: string
  /** 用户ID */
  userId?: string
  /** 消息负载 */
  payload?: unknown
  /** 时间戳 */
  timestamp: number
}

/**
 * 房间管理器
 */
export class RoomManager {
  private rooms: Map<string, WSRoom> = new Map()

  /**
   * 加入房间
   */
  join(roomId: string, conn: WSConnection): WSRoom {
    let room = this.rooms.get(roomId)
    if (!room) {
      room = { id: roomId, connections: new Set(), createdAt: Date.now() }
      this.rooms.set(roomId, room)
    }
    room.connections.add(conn)
    return room
  }

  /**
   * 离开房间
   */
  leave(roomId: string, conn: WSConnection): void {
    const room = this.rooms.get(roomId)
    if (room) {
      room.connections.delete(conn)
      if (room.connections.size === 0) {
        this.rooms.delete(roomId)
      }
    }
  }

  /**
   * 广播消息到房间
   */
  broadcast(roomId: string, message: WSMessage): number {
    const room = this.rooms.get(roomId)
    if (!room) return 0

    const data = JSON.stringify(message)
    let count = 0
    for (const conn of room.connections) {
      try {
        if (conn.readyState === 1) {
          // OPEN
          conn.send(data)
          count++
        }
      } catch {
        // 连接已关闭
      }
    }
    return count
  }

  /**
   * 获取房间信息
   */
  getRoom(roomId: string): WSRoom | undefined {
    return this.rooms.get(roomId)
  }

  /**
   * 获取所有房间
   */
  listRooms(): WSRoom[] {
    return Array.from(this.rooms.values())
  }

  /**
   * 获取房间统计
   */
  getStats(): { totalRooms: number; totalConnections: number } {
    let totalConnections = 0
    for (const room of this.rooms.values()) {
      totalConnections += room.connections.size
    }
    return { totalRooms: this.rooms.size, totalConnections }
  }
}

/**
 * 全局房间管理器
 */
export const globalRoomManager = new RoomManager()

import { describe, it, expect } from 'vitest'
import { RoomManager } from './server'

describe('RoomManager', () => {
  it('should create and join room', () => {
    const manager = new RoomManager()
    const conn = { readyState: 1, send: () => {}, on: () => {} }
    const room = manager.join('contract-1', conn)

    expect(room.id).toBe('contract-1')
    expect(room.connections.size).toBe(1)
  })

  it('should leave and cleanup empty room', () => {
    const manager = new RoomManager()
    const conn = { readyState: 1, send: () => {}, on: () => {} }
    manager.join('contract-1', conn)
    manager.leave('contract-1', conn)

    expect(manager.getRoom('contract-1')).toBeUndefined()
  })

  it('should broadcast to room', () => {
    const manager = new RoomManager()
    let received = 0
    const conn = {
      readyState: 1,
      send: () => { received++ },
      on: () => {},
    }
    manager.join('contract-1', conn)
    const count = manager.broadcast('contract-1', {
      type: 'broadcast',
      payload: { test: true },
      timestamp: Date.now(),
    })

    expect(count).toBe(1)
    expect(received).toBe(1)
  })

  it('should not send to closed connections', () => {
    const manager = new RoomManager()
    const conn = { readyState: 3, send: () => {}, on: () => {} } // CLOSED
    manager.join('contract-1', conn)
    const count = manager.broadcast('contract-1', {
      type: 'broadcast',
      timestamp: Date.now(),
    })

    expect(count).toBe(0)
  })

  it('should return correct stats', () => {
    const manager = new RoomManager()
    const conn1 = { readyState: 1, send: () => {}, on: () => {} }
    const conn2 = { readyState: 1, send: () => {}, on: () => {} }
    manager.join('room-1', conn1)
    manager.join('room-2', conn2)

    const stats = manager.getStats()
    expect(stats.totalRooms).toBe(2)
    expect(stats.totalConnections).toBe(2)
  })
})

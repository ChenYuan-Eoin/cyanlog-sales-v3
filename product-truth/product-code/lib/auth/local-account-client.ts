'use client'

export function completeLocalAccountLogin(token: string): void {
  // The server already set Secure cookies. Do not overwrite them from JavaScript.
  localStorage.setItem('token', token)
  // A full navigation discards any previous member's router/layout state.
  window.location.replace('/')
}

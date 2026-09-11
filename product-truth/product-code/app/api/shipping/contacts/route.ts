import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { contactSchema } from '@/lib/shipping/validation'
import { listShippingContacts, saveShippingContact } from '@/lib/shipping/contacts'
export const runtime = 'nodejs'
const inputSchema = z.object({ id: z.string().uuid().optional(), label: z.string().trim().min(1).max(40), contact: contactSchema }).strict()
export async function GET(req: NextRequest) { return shippingHandler(req, async user => ({ contacts: await listShippingContacts(user.id) })) }
export async function POST(req: NextRequest) { return shippingHandler(req, async user => { const input = inputSchema.parse(await shippingJson(req)); return saveShippingContact(user.id, input.label, input.contact, input.id) }) }

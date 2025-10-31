export interface Plan {
id?: string
title: string
expectedMinutes: number
actualMinutes?: number
dueAt: string // ISO
note?: string
createdAt?: string
}
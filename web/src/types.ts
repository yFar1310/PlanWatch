export interface Plan {
dependsOn: null
id?: string
title: string
expectedMinutes: number
actualMinutes?: number
dueAt: string // ISO
note?: string
createdAt?: string,
}
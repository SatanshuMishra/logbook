import { env, cwd } from 'node:process'

export const readHome = (): string | undefined => env['HOME']

export const currentDirectory = (): string => cwd()

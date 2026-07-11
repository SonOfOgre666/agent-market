import { config } from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Repo root (monorepo): apps/api/src → ../../../.env
config({ path: path.resolve(__dirname, '../../../.env') })

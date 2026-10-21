// Writes WIKI.md from the game data. Run `npm run wiki` after changing skills, augments, reactions, statuses or enemies.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultData, genWiki } from '@conflux/shared';

writeFileSync(fileURLToPath(new URL('../WIKI.md', import.meta.url)), genWiki(defaultData()));
console.log('wrote WIKI.md');

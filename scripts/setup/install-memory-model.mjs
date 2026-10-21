import {installMemoryModel,memoryModel} from '../../src/features/memory/memory-model.mjs';
const directory=process.argv[2];if(!directory)throw Error('Usage: node scripts/setup/install-memory-model.mjs <model-directory>');
await installMemoryModel({directory,onProgress:p=>{if(p%10===0&&p!==globalThis.last){globalThis.last=p;console.log('Kuneco memory model '+p+'%');}}});console.log('Installed '+memoryModel.id+' @ '+memoryModel.revision);

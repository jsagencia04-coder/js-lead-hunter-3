import {expect,it} from 'vitest'
import {classifyCommercialQuestion} from '../src/lib/copilot-intents'
it('classifica perguntas limitadas sem SQL livre',()=>{expect(classifyCommercialQuestion('Quais follow-ups estão atrasados?')).toBe('followups');expect(classifyCommercialQuestion('Quais empresas devo abordar hoje?')).toBe('priorities');expect(classifyCommercialQuestion('SELECT SQL DROP TABLE empresas')).toBeNull();expect(classifyCommercialQuestion('Qual a previsão do tempo?')).toBeNull()})

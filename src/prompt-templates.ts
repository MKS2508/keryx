/**
 * Standardized prompt templates for AI commit analysis.
 * Ensures consistent, parseable responses across all scripts.
 * Supports dynamic project configuration.
 *
 * @module prompt-templates
 */

import type { IGeminiPromptConfig, IStandardResponseFormat } from './types/index.js';
import { parseTrailers, TRAILER_KEYS, type ITrailer } from './trailers.js';
import { COMPLEXITY_RUBRIC } from './types/decision.types.js';

// Re-export types for backward compatibility
export type { IGeminiPromptConfig as GeminiPromptConfig } from './types/index.js';
export type { IStandardResponseFormat as StandardResponseFormat } from './types/index.js';

/**
 * Generate the standard prompt prefix with dynamic project context.
 * @param ctx - Project context for the prompt
 * @returns Formatted prompt prefix string
 */
function createPromptPrefix(ctx: IGeminiPromptConfig['projectContext']): string {
    return `# Sistema de Análisis Inteligente - ${ctx.name}

Eres un asistente especializado en análisis de código y automatización para el proyecto ${ctx.name}. Tu función es proporcionar respuestas estructuradas, precisas y consistentes que puedan ser parseadas automáticamente.

## REGLAS CRÍTICAS DE FORMATO

1. **FORMATO DE RESPUESTA OBLIGATORIO**: Todas tus respuestas deben seguir exactamente el formato especificado más abajo.
2. **CONSISTENCIA**: Mantén la misma estructura sin importar la complejidad del análisis.
3. **PARSEABLE**: El formato debe ser fácil de procesar automáticamente con expresiones regulares.
4. **BLOQUES MARKDOWN**: Usa \`\`\`markdown para bloques de código cuando se especifique.
5. **SECCIONES TÉCNICAS**: Siempre incluye las secciones <technical> y <changelog> cuando sea aplicable.

## Contexto del Proyecto
**Nombre**: ${ctx.name}
**Descripción**: ${ctx.description}
**Versión Actual**: ${ctx.version}
**Stack Tecnológico**: ${ctx.techStack.join(', ')}
**Plataforma Objetivo**: ${ctx.targetPlatform}

---
`;
}

/** Standard suffix with formatting instructions */
const STANDARD_PROMPT_SUFFIX = `

---

## INSTRUCCIONES FINALES

1. **Lee cuidadosamente** toda la información proporcionada
2. **Analiza el contexto** y los datos específicos
3. **Genera una respuesta** siguiendo EXACTAMENTE el formato especificado
4. **Mantén consistencia** en la estructura y sintaxis
5. **No desvíes** del formato requerido bajo ninguna circunstancia

**IMPORTANTE**: La respuesta debe ser parseada automáticamente. Cualquier desviación del formato especificado causará errores en el sistema.`;

/**
 * Generate prompt for commit analysis.
 * @param config - Prompt configuration with project context and data
 * @returns Formatted commit analysis prompt
 */
export function createCommitPrompt(config: IGeminiPromptConfig): string {
    const { data, specificContext, projectContext, components, commitFormat, decisions } = config;
    const prefix = createPromptPrefix(projectContext);

    const componentsSection = components && components.length > 0
        ? `\n## Componentes del Proyecto (Monorepo)\n${components.map(c => `- **${c.id}** → \`${c.path}\` — ${c.name}`).join('\n')}\n\nUsa el ID del componente como "área" en el prefijo del commit (ej: \`feat(web):\`, \`fix(agent-backend):\`).\n`
        : '';

    const decisionsSection = decisions
        ? `\n## DECISIONES DEL CLASSIFIER (jev)

Estas clasificaciones son la primera opinión. Úsalas como guía — puedes discrepar si tienes razón documentada en el diff.

\`\`\`json
${JSON.stringify(decisions, null, 2)}
\`\`\`

Notas de interpretación:
- \`commit_type\`: sugerencia del prefijo Conventional Commits. Si discrepas, justifica en el body.
- \`scope\`: ID de componente o "general". Solo aplica si la repo tiene monorepo / componentes.
- \`breaking\` (0..1): probabilidad de que rompa contrato. Si > 0.5, incluye trailer \`Breaking:\`.
- \`changelog_worthy\` (0..1): si > 0.5, rellena la sección \`<changelog>\` con entrada user-facing.
- \`single_vs_multi\` (1 = un commit, 0 = varios): si < 0.5, genera varios \`### **Propuesta de Commit #N\`.
- \`complexity\` (0..5 sobre ${COMPLEXITY_RUBRIC.join(' / ')}): si >= 3, la sección \`<technical>\` debe ser sustancial.

`
        : '';

    const titleLang = commitFormat?.titleLanguage || 'english';
    const bodyLang = commitFormat?.bodyLanguage || 'spanish';
    const includeTech = commitFormat?.includeTechnical !== false;
    const includeChangelog = commitFormat?.includeChangelog !== false;
    const includeTrailers = commitFormat?.includeTrailers !== false;

    const formatInstructions = `
## REGLAS DE IDIOMA Y FORMATO
- **Título del commit**: en **${titleLang}**
- **Descripción/body del commit**: en **${bodyLang}**
- **Sección <technical>**: ${includeTech ? 'OBLIGATORIA — incluir siempre' : 'OMITIR'}
- **Sección <changelog>**: ${includeChangelog ? 'OBLIGATORIA — incluir siempre' : 'OMITIR'}
- **Sección <trailers>**: ${includeTrailers ? 'SÓLO cuando aplique alguna clave (ver reglas de trailers)' : 'OMITIR'}
${includeTrailers ? `
## REGLAS DE TRAILERS DE RELEASE
Al final del commit, cuando el cambio lo justifique, añade trailers en formato \`Clave: valor\` (una línea por clave). El pipeline de changelog los convierte en prosa de release:
- \`Release-Note:\` — feat/fix con impacto visible para el usuario (una frase, cara de usuario).
- \`Breaking:\` — el cambio rompe compatibilidad, contrato o comportamiento esperado (di qué se rompe y para quién).
- \`Upgrade-Step:\` — actualizar exige un paso de migración (contrato, schema, config).
- \`Security:\` — el cambio corrige o endurece seguridad.
Si ninguna clave aplica, omite la sección \`<trailers>\` entera. Nunca inventes claves fuera de: ${TRAILER_KEYS.join(', ')}.
` : ''}`;

    return `${prefix}
${componentsSection}
# ANÁLISIS DE COMMITS
${formatInstructions}
${decisionsSection}## Datos del Análisis
${JSON.stringify(data, null, 2)}

## Contexto Adicional
${specificContext || 'Ninguno proporcionado'}

---

## FORMATO DE RESPUESTA REQUERIDO

Tu respuesta debe seguir EXACTAMENTE esta estructura:

### **ANÁLISIS PRINCIPAL**

[Descripción general de los cambios detectados]

---

### **Propuesta de Commit #1**

\`\`\`markdown
[prefijo](área - descripción breve en ${titleLang})

[Descripción completa en ${bodyLang} de QUÉ se logró y POR QUÉ]
${includeTech ? `
<technical>
[Detalles técnicos específicos: archivos modificados, funciones añadidas, refactorizaciones, etc.]
</technical>` : ''}
${includeChangelog ? `
<changelog>
## [Tipo] [Emoji]
[Entrada para changelog de la app, optimizada para mostrar al usuario]
</changelog>` : ''}${includeTrailers ? `
<trailers>
Release-Note: [sólo si el commit tiene impacto visible para el usuario]
Breaking: [sólo si rompe compatibilidad o contrato]
Upgrade-Step: [sólo si actualizar exige un paso de migración]
Security: [sólo si es un cambio de seguridad]
</trailers>` : ''}
\`\`\`

### **Archivos de la Propuesta #1** (OBLIGATORIO)

Lista de paths EXACTOS a incluir en este commit (relativos al project root).
Cada commit DEBE declarar sus archivos — sin esto el commit será rechazado.

\`\`\`files
src/commit-generator.ts
tests/staging.test.ts
\`\`\`

### **Propuesta de Commit #2** (solo si es necesario)

[Repetir formato anterior + sección "Archivos de la Propuesta #2" con su propia lista]

---

**DECISIÓN**: [Explicación breve de por qué uno o múltiples commits]

${STANDARD_PROMPT_SUFFIX}`;
}

/**
 * Generic parser for Gemini AI responses.
 * Extracts structured data from formatted markdown responses.
 */
export class GeminiResponseParser {
    /**
     * Extract multiple commit proposals from standard format.
     * @param response - Raw AI response text
     * @returns Array of parsed commit proposals
     */
    static parseCommitProposals(response: string): Array<{
        title: string;
        description: string;
        technical: string;
        changelog: string;
        trailers: ITrailer[];
        files: string[];
    }> {
        const proposals: Array<{
            title: string;
            description: string;
            technical: string;
            changelog: string;
            trailers: ITrailer[];
            files: string[];
        }> = [];

        const proposalPattern = /###\s*\*\*Propuesta de Commit #\d+\*\*/g;
        const proposalMatches = Array.from(response.matchAll(proposalPattern));

        if (proposalMatches.length === 0) {
            const codeBlock = this.extractCodeBlock(response);
            if (codeBlock) {
                const parsed = this.parseCommitContent(codeBlock);
                if (parsed) proposals.push(parsed);
            }
        } else {
            for (let i = 0; i < proposalMatches.length; i++) {
                const startIndex = proposalMatches[i].index!;
                const endIndex = proposalMatches[i + 1]?.index || response.length;
                const proposalSection = response.substring(startIndex, endIndex);

                const codeBlock = this.extractCodeBlock(proposalSection);
                if (codeBlock) {
                    const parsed = this.parseCommitContent(codeBlock);
                    if (parsed) proposals.push(parsed);
                }
            }
        }

        // After extracting the commit bodies, look for the `### Archivos
        // de la Propuesta #N` sections and attach the file list to the
        // matching proposal. If absent, the proposal keeps `files: []`
        // and executeCommit will refuse to apply it (F4: MISSING_PROPOSAL_FILES).
        const fileSectionPattern = /###\s*\*\*Archivos de la Propuesta #(\d+)\*\*/g;
        const fileMatches = Array.from(response.matchAll(fileSectionPattern));
        for (const fm of fileMatches) {
            const index = parseInt(fm[1], 10) - 1;
            const target = proposals[index];
            if (!target) continue;
            const sectionStart = fm.index!;
            const nextSectionMatch = response
                .substring(sectionStart + 1)
                .match(/###\s*\*\*(?:Propuesta de Commit|Archivos de la Propuesta|Decision)/);
            const sectionEnd = nextSectionMatch
                ? sectionStart + 1 + nextSectionMatch.index!
                : response.length;
            const section = response.substring(sectionStart, sectionEnd);
            target.files = this.extractFilesList(section);
        }

        return proposals;
    }

    /**
     * Extract file paths from an "Archivos de la Propuesta" section.
     *
     * Accepts two shapes:
     * - Fenced block: ```files\npath1\npath2\n```
     * - Plain list: lines starting with `- path` after a header
     *
     * @param section - The raw section text
     * @returns Deduplicated list of file paths
     */
    private static extractFilesList(section: string): string[] {
        const out: string[] = [];

        // Try fenced block first
        const fenceMatch = section.match(/```(?:files)?\s*\n([\s\S]*?)\n```/);
        if (fenceMatch) {
            for (const raw of fenceMatch[1].split('\n')) {
                const trimmed = raw.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                // Strip leading list markers (`-`, `*`)
                const cleaned = trimmed.replace(/^[-*]\s+/, '');
                if (cleaned) out.push(cleaned);
            }
            return [...new Set(out)];
        }

        // Fallback: plain list
        for (const raw of section.split('\n')) {
            const trimmed = raw.trim();
            if (!trimmed) continue;
            const m = trimmed.match(/^[-*]\s+(.+)$/);
            if (m) out.push(m[1].trim());
        }
        return [...new Set(out)];
    }

    /**
     * Extract a markdown code block from text.
     * @param text - Text containing a code block
     * @returns Extracted code block content, or null
     */
    private static extractCodeBlock(text: string): string | null {
        const patterns = [
            /```markdown\s*\n([\s\S]*?)\n```/,
            /```\s*\n([\s\S]*?)\n```/,
            /```([\s\S]*?)```/,
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[1].trim();
        }

        return null;
    }

    /**
     * Parse the content of an individual commit proposal.
     * @param content - Raw commit content string
     * @returns Parsed commit object, or null if unparseable
     */
    private static parseCommitContent(content: string): {
        title: string;
        description: string;
        technical: string;
        changelog: string;
        trailers: ITrailer[];
        files: string[];
    } | null {
        const lines = content.split('\n');

        let title = '';
        let titleIndex = 0;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim()) {
                title = lines[i].trim();
                titleIndex = i;
                break;
            }
        }

        if (!title) return null;

        let description = '';
        let technical = '';
        let changelog = '';
        let trailersRaw = '';
        let currentSection = 'description';

        for (let i = titleIndex + 1; i < lines.length; i++) {
            const line = lines[i];

            if (line.includes('<technical>')) {
                currentSection = 'technical';
                continue;
            } else if (line.includes('</technical>')) {
                currentSection = 'none';
                continue;
            } else if (line.includes('<changelog>')) {
                currentSection = 'changelog';
                continue;
            } else if (line.includes('</changelog>')) {
                currentSection = 'none';
                continue;
            } else if (line.includes('<trailers>')) {
                currentSection = 'trailers';
                continue;
            } else if (line.includes('</trailers>')) {
                currentSection = 'none';
                continue;
            }

            if (currentSection === 'description' && line.trim()) {
                description += line + '\n';
            } else if (currentSection === 'technical') {
                technical += line + '\n';
            } else if (currentSection === 'changelog') {
                changelog += line + '\n';
            } else if (currentSection === 'trailers') {
                trailersRaw += line + '\n';
            }
        }

        return {
            title,
            description: description.trim(),
            technical: technical.trim(),
            changelog: changelog.trim(),
            trailers: parseTrailers(trailersRaw),
            files: [],
        };
    }
}

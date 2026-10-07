if (typeof console !== "undefined" && (typeof globalThis !== "undefined" && globalThis.__FLOW_SILENT__ === true)) {
    console.log = function () { }; console.warn = function () { }; console.error = function () { };
}
/**
 * table-importer.js — Markdown 表格与 CSV 分镜表智能解析器
 * 支持从 Notion、飞书、Excel、ChatGPT 复制的表格一键提取为 Flow Studio Pro 分镜队列
 */

(function () {
    'use strict';

    /**
     * 智能解析 Markdown 表格或 CSV/TSV 文本
     * @param {string} rawText 
     * @returns {{ ok: boolean, count: number, prompts: Array<{ number: string, prompt: string, shotType?: string, camera?: string, raw?: string }>, error?: string }}
     */
    function parseTableToPrompts(rawText) {
        if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
            return { ok: false, count: 0, prompts: [], error: '输入内容为空' };
        }

        const lines = rawText.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) {
            return { ok: false, count: 0, prompts: [], error: '没有有效行' };
        }

        // 1. 判断是否为 Markdown 表格 (包含至少一个包含 | 的行)
        const isMarkdown = lines.some(l => l.includes('|'));

        if (isMarkdown) {
            return parseMarkdownTable(lines);
        } else {
            return parseDelimitedTable(lines);
        }
    }

    /**
     * 解析 Markdown 表格
     */
    function parseMarkdownTable(lines) {
        // 过滤出所有包含 | 的行
        const tableLines = lines.filter(l => l.includes('|'));
        if (tableLines.length < 2) {
            return { ok: false, count: 0, prompts: [], error: 'Markdown 表格格式不完整 (缺少表头或数据行)' };
        }

        // 拆分每一行单元格
        const rows = tableLines.map(line => {
            // 去掉首尾的 |
            const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
            return trimmed.split('|').map(c => c.trim());
        });

        // 寻找表头行与分隔行 (|---|---|)
        let headerRowIndex = 0;
        let dividerRowIndex = -1;

        for (let i = 0; i < rows.length; i++) {
            const isDivider = rows[i].every(cell => /^:?-+:?$/.test(cell.replace(/\s+/g, '')));
            if (isDivider) {
                dividerRowIndex = i;
                headerRowIndex = i - 1;
                break;
            }
        }

        if (dividerRowIndex <= 0) {
            // 没找到标准的 |---| 分隔符，默认第一行为表头，从第二行开始为数据
            headerRowIndex = 0;
            dividerRowIndex = 0;
        }

        const headers = rows[headerRowIndex].map(h => h.toLowerCase());
        const dataRows = rows.slice(dividerRowIndex + 1);

        // 匹配关键列索引
        const colIndices = resolveColumnIndices(headers);

        const results = [];
        let seq = 1;

        for (const row of dataRows) {
            // 跳过空行或非数据行
            if (row.length === 0 || row.every(c => !c)) continue;

            const shotPrompt = composePromptFromRow(row, colIndices);
            if (shotPrompt) {
                results.push({
                    number: String(seq++).padStart(2, '0'),
                    prompt: shotPrompt
                });
            }
        }

        if (results.length === 0) {
            return { ok: false, count: 0, prompts: [], error: '未能从表格中解析出有效提示词' };
        }

        return { ok: true, count: results.length, prompts: results };
    }

    /**
     * 解析 CSV / TSV 格式 (逗号或制表符)
     */
    function parseDelimitedTable(lines) {
        const delimiter = lines[0].includes('\t') ? '\t' : ',';
        const rows = lines.map(line => line.split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, '')));

        if (rows.length < 1) {
            return { ok: false, count: 0, prompts: [], error: 'CSV 格式不正确' };
        }

        const headers = rows[0].map(h => h.toLowerCase());
        const colIndices = resolveColumnIndices(headers);

        const hasHeader = colIndices.prompt >= 0;
        const dataRows = hasHeader ? rows.slice(1) : rows;

        const results = [];
        let seq = 1;

        for (const row of dataRows) {
            if (row.length === 0 || row.every(c => !c)) continue;
            const shotPrompt = hasHeader
                ? composePromptFromRow(row, colIndices)
                : row.join(' ').trim();

            if (shotPrompt) {
                results.push({
                    number: String(seq++).padStart(2, '0'),
                    prompt: shotPrompt
                });
            }
        }

        return { ok: results.length > 0, count: results.length, prompts: results };
    }

    /**
     * 智能识别表头列索引
     */
    function resolveColumnIndices(headers) {
        const indices = {
            num: -1,
            shotType: -1,
            character: -1,
            scene: -1,
            prompt: -1,
            camera: -1
        };

        headers.forEach((h, idx) => {
            const clean = h.replace(/[\s_\-#]/g, '');
            if (/^(镜头号?|序号|编号|no|shot|index|num)$/i.test(clean)) indices.num = idx;
            else if (/^(景别|景次|机位|shottype|scale)$/i.test(clean)) indices.shotType = idx;
            else if (/^(角色|人物|演员|character|actor)$/i.test(clean)) indices.character = idx;
            else if (/^(场景|地点|环境|scene|location)$/i.test(clean)) indices.scene = idx;
            else if (/^(运镜|镜头运动|运镜方式|camera|motion)$/i.test(clean)) indices.camera = idx;
            else if (/^(提示词|画面内容|分镜内容|画面描述|prompt|description|visual)$/i.test(clean)) indices.prompt = idx;
        });

        // 如果没有明确叫“提示词”的列，寻找最长列或非编号列作为主要 prompt
        if (indices.prompt === -1) {
            indices.prompt = headers.findIndex((_, idx) => idx !== indices.num);
        }

        return indices;
    }

    /**
     * 将单行数据重组为符合 Google Flow 的影视级 Prompt
     */
    function composePromptFromRow(row, colIndices) {
        const mainPrompt = colIndices.prompt >= 0 ? (row[colIndices.prompt] || '') : row.join(', ');
        if (!mainPrompt.trim()) return '';

        const charTag = colIndices.character >= 0 ? (row[colIndices.character] || '').trim() : '';
        const sceneTag = colIndices.scene >= 0 ? (row[colIndices.scene] || '').trim() : '';
        const shotType = colIndices.shotType >= 0 ? (row[colIndices.shotType] || '').trim() : '';
        const camera = colIndices.camera >= 0 ? (row[colIndices.camera] || '').trim() : '';

        const parts = [];

        // 角色与场景标签优先
        if (charTag && !mainPrompt.includes(charTag)) {
            parts.push(charTag.startsWith('@') ? charTag : `@${charTag}`);
        }
        if (sceneTag && !mainPrompt.includes(sceneTag)) {
            parts.push(sceneTag.startsWith('@') ? sceneTag : `@${sceneTag}`);
        }

        // 景别
        if (shotType && !mainPrompt.includes(shotType)) {
            parts.push(`${shotType} shot`);
        }

        // 核心画面描述
        parts.push(mainPrompt);

        // 运镜指令
        if (camera && !mainPrompt.includes(camera)) {
            parts.push(`Camera ${camera}`);
        }

        return parts.join(', ').replace(/\s+/g, ' ').trim();
    }

    const root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
    root.tableImporter = {
        parseTableToPrompts
    };
})();

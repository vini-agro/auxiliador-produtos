// automation/src/resultReporter.js

/**
 * Formata a linha final de resultado estruturado que process-video.js imprime
 * em cada ponto de saída, pro n8n conseguir decidir o próximo passo do workflow
 * (ver automation/n8n/vigia-vimeo.workflow.json, nó "Parsear resultado").
 * @param {'ok' | 'manual_review' | 'error'} status
 * @param {object} [details]
 * @returns {string}
 */
export function formatResultLine(status, details = {}) {
  return `RESULT_JSON: ${JSON.stringify({ status, ...details })}`;
}

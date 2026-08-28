/**
 * LLM 출력에서 JSON 오브젝트를 안전하게 추출한다.
 * response_format을 지원하지 않는 서버는 코드펜스나 설명 문장을 함께 반환할 수 있다 (§11).
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim();
  if (!text) throw new Error('LLM이 빈 응답을 반환했습니다');

  const candidates: string[] = [];

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(text);

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 다음 후보 시도
    }
    try {
      // 흔한 깨짐: 마지막 요소의 트레일링 콤마
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      // 계속
    }
  }
  throw new Error(`LLM 응답을 JSON으로 파싱하지 못했습니다: ${text.slice(0, 200)}`);
}

/**
 * 일부 모델은 결과를 한 겹 더 감싼다 ({"analysis": {...}}, {"result": {...}}).
 * 스키마 검증 실패 시 한 단계 벗겨 재시도할 수 있도록 후보를 만들어 준다.
 */
export function unwrapCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    // 최상위를 배열로 감싸 보내는 모델 대응
    return value.filter((inner) => typeof inner === 'object' && inner !== null);
  }
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value as Record<string, unknown>).filter(
    (inner) => typeof inner === 'object' && inner !== null,
  );
}

/** 내용이 사실상 비어 있는 응답인지 (추론형 모델이 content를 비우는 경우) */
export function isEmptyPayload(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

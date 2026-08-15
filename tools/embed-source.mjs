// embed-source.mjs — 번들 임베드용 소스 읽기 (EOL 결정성 계약)
//
// 작업 트리의 CRLF 가 임베드 문자열(JSON `\r` 이스케이프)로 새어 «커밋된 소스만으로
// 번들이 재현되지 않는» 결함을 만들었다 (2026-08-15 판정:
// test/output/claude-bundle-repro-f2dbb2b.md — dist 와 pristine 재빌드의 차이가 100%
// EOL, 989개 `\r`). git 인덱스는 `.gitattributes` 로 LF 정규화되므로, 임베드도 LF 로
// 정규화해야 작업 트리 상태와 무관하게 결정적이다. 같은 트리에서의 재빌드 비교(동기화
// 테스트)는 이 클래스를 원리적으로 못 잡는다 — 가드는 여기서 즉시 실패로 잡는다.
import { readFileSync } from 'node:fs';

export function readSourceLf(filePath) {
  const code = readFileSync(filePath, 'utf8').replaceAll('\r\n', '\n');
  if (code.includes('\r')) {
    throw new Error('임베드 소스에 정규화 후에도 CR 이 남아 있다: ' + filePath);
  }
  return code;
}

# Marathon Calendar

GitHub Actions가 국내 마라톤 공개 일정을 수집하고, 정규화한 `races.json`과 월별 캘린더를 GitHub Pages에 배포하는 정적 사이트입니다. 지속 실행 서버, 데이터베이스, Google 계정 자격 증명은 사용하지 않습니다.

## 데이터 흐름

1. Actions가 매일 06:20 UTC와 수동 실행 시 수집을 시작합니다.
2. 8개 공개 출처를 순차적으로 확인하고, 출처별 요청 결과를 기록합니다.
3. 대회명·개최일·장소를 보수적으로 기준 삼아 중복을 합칩니다.
4. `public/races.json`을 생성하고 Vite가 이를 `dist/`에 포함합니다.
5. Pages 아티팩트만 배포합니다. 생성 JSON은 커밋하지 않습니다.

## 수집 출처

| 출처 | 역할 | 알려진 한계 |
| --- | --- | --- |
| GoRunning | 상세 일정·참가비 확인 | 참가비와 종목은 상세 본문에만 있을 수 있습니다. |
| KorMarathon | 접수기간·가격 보강 | 공식 홈페이지 링크가 접수 링크와 다를 수 있습니다. |
| e-Marathon | 일정·종목 확인 | 가격과 접수 정보가 자유 본문에 있을 수 있습니다. |
| Maedal | 메타데이터 보강 | 상세 본문은 클라이언트 렌더링일 수 있어 가격을 보장하지 않습니다. |
| 대한육상연맹 | 주요 공인 대회 검증 | 접수·참가비·신청 링크를 제공하지 않을 수 있습니다. |
| Marathon Moa | 광범위한 보조 일정 | 가격과 종목이 없는 경우가 있습니다. |
| RunningMap | 보조 일정 | 가격이 없는 경우가 있습니다. |
| MarathonMate | 교차 확인 | 참고용 정보이므로 단독 확정 출처로 쓰지 않습니다. |

수집기는 로그인, CAPTCHA, 관리자/API 경로, 접근 제어 우회를 하지 않습니다. 필드가 공개 페이지에 없으면 추측하지 않고 `null` 또는 안내 메모로 남깁니다.

## 공개 데이터 계약

`races.json`은 다음을 포함합니다.

- 대회명, 개최일, 접수 마감일, 장소, 지역
- 공개 페이지에서 확인된 코스(`풀`, `하프`, `10K`, `5K`)와 코스별 참가비
- 코스가 공개되지 않으면 빈 배열, 코스는 확인되지만 참가비가 없으면 `null`
- 출처 배열, 검증 상태, 마지막 확인 시각, 접수 상태
- 생성 시각과 출처별 `attempted`, `succeeded`, `recordCount`, `message`

사이트는 생성 시각을 표시하고, 일부 출처가 실패하면 화면에 해당 출처를 명시합니다. 등록 전에는 반드시 주최 측 신청 링크에서 최신 정보를 확인해야 합니다.

## 로컬 실행

```bash
bun install

# 고정 HTML로 오프라인 수집 및 JSON 생성
bun run collect -- --fixture tests/fixtures
bun run validate
bun run build

# 품질 확인
bun run typecheck
bun run lint
bun test
bun run test

# 정적 사이트 미리보기
bun run preview
```

실제 공개 목록을 수집하려면 `bun run collect`를 실행합니다. 각 출처 실패는 `races.json`의 `collectionMetadata`에 기록되며, 다른 출처의 결과를 막지 않습니다.

## GitHub Pages 설정

1. 이 프로젝트를 GitHub 저장소의 기본 브랜치에 올립니다.
2. **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택합니다.
3. **Actions → Collect and deploy marathon calendar → Run workflow**로 첫 배포를 수동 실행합니다.
4. 성공 후 Actions 출력의 Pages URL을 열어 달력과 `races.json`을 확인합니다.

원격 Pages의 OIDC 배포와 예약 실행은 GitHub에서만 확인할 수 있습니다. 워크플로는 `contents: read`만 사용하며, 배포 작업에만 `pages: write`와 `id-token: write`를 부여합니다.

## 품질 기준

- 모든 파서는 실제 네트워크가 아닌 고정 HTML/XML 테스트 자료로 검증합니다.
- TypeScript 엄격 검사, Biome, Bun 테스트 러너와 Vitest, JSON 스키마 검증, Vite 생산 빌드를 실행합니다.
- UI 토큰·상태·반응형 규칙은 [DESIGN.md](./DESIGN.md)에 정의합니다.

## 인수인계 문서

- [ARCHITECTURE.md](./ARCHITECTURE.md): 구성요소, 데이터 계약, 배포 경계
- [OPERATIONS.md](./OPERATIONS.md): Actions·Pages 설정과 일상 운영 절차
- [DEVELOPMENT.md](./DEVELOPMENT.md): 파일별 책임, 테스트 방식, 다음 개발 작업
- [STATUS.md](./STATUS.md): 이 작업 세션의 실제 검증 결과와 알려진 제한

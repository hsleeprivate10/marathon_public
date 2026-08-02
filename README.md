# Marathon Calendar

GitHub Actions가 국내 마라톤 공개 일정을 수집하고, 정규화한 `races.json`, 월별 홈페이지, `#/calendar` 캘린더를 GitHub Pages에 배포하는 정적 사이트입니다. 지속 실행 서버, 데이터베이스, Google 계정 자격 증명은 사용하지 않습니다.

## 데이터 흐름

1. Actions가 `main` push, 매일 06:20 UTC, 또는 수동 실행 시 수집을 시작합니다.
2. 9개 공개 일정 출처를 순차적으로 확인합니다. 이 출처들은 발견 인덱스이며, 목록과 검색 페이지는 출처 상세 후보와 일시적인 대회명·개최일 신원 근거만 만듭니다.
3. 소유한 출처 상세 페이지를 읽어 공식 홈페이지 또는 신청 문맥 링크를 typed traversal evidence로 남깁니다. 신청, 접수, 참가 링크는 직접 게시하지 않지만, 중앙 traversal 단계에서만 신원 검증용 씨앗으로 검사할 수 있습니다.
4. 의미 단계는 고정입니다. level 0은 일정 목록, level 1은 어댑터가 소유한 출처 상세, level 2는 외부 공식 또는 신청 씨앗, level 3은 선택적인 최종 공식 페이지입니다. HTTP 리디렉션은 매번 다시 검증하지만 이 의미 깊이에 더하지 않습니다.
5. 중앙 traversal은 실행당 40개 외부 fetch, 대회 체인당 2개 외부 fetch, 호스트당 10개 fetch, 신원 통과 페이지당 정렬된 child link 3개로 제한합니다. 정확히 같은 씨앗 URL은 가져오기 전에 한 번으로 합칠 수 있습니다. 공식 페이지를 받아 URL 목적, DNS, 공개 IP, 리디렉션, 콘텐츠, 대회 신원, 필수 필드 파싱을 통과한 경우에만 공개 `Race` 필드를 만들고, 의미상 같은 대회 병합은 그 뒤에 수행합니다.
6. 하나 이상의 출처 수집 단계가 성공하면 받아들인 공식 대회가 0건이어도 `races: []`인 유효한 `public/races.json`을 생성하고 Vite가 이를 `dist/`에 포함합니다. 모든 출처 수집 단계가 실패한 경우에만 닫힌 상태로 실패하며 기존 출력을 보존합니다.
7. Pages 아티팩트만 배포합니다. 생성 JSON은 커밋하지 않습니다.

## 수집 출처

| 출처 | 역할 | 알려진 한계 |
| --- | --- | --- |
| GoRunning | 발견 인덱스 | 소유 상세 페이지에서 안전한 공식 홈페이지 후보를 찾지 못하면 닫힌 상태로 끝납니다. |
| MarathonGo | 발견 인덱스와 owned detail | 국내 일정 목록과 `/raceDetail/domestic/{slug}` 상세를 사용합니다. 상세의 `신청하기` 링크는 traversal evidence일 뿐 MarathonGo URL이나 신청 URL로 게시되지 않습니다. 외부 공식 페이지가 같은 대회로 검증된 뒤 날짜나 장소만 빠진 경우에만 상세의 날짜·장소를 내부 provenance로 보충할 수 있습니다. |
| KorMarathon | 발견 인덱스 | 공식 홈페이지 링크와 참가 신청 링크를 구분하며, 신청 링크는 공식 페이지로 가져오지 않습니다. |
| e-Marathon | 발견 인덱스 | 목록과 상세의 장소·종목·가격은 신원 근거가 아니면 공개 필드가 아닙니다. |
| Maedal | 발견 인덱스 | 상세 본문이 클라이언트 렌더링이어도 공식 후보가 없으면 게시하지 않습니다. |
| 대한육상연맹 | 발견 인덱스 | KAAF 페이지, 결과, 문서만 있으면 게시 가능한 공식 대회가 없을 수 있습니다. |
| Marathon Moa | 발견 인덱스 | 넓은 일정 후보를 만들지만 공개 필드는 공식 페이지에서만 나옵니다. |
| RunningMap | 발견 인덱스 | 목록 소유 외부 링크는 공식 후보가 아니며 상세 문맥이 필요합니다. |
| MarathonMate | 발견 인덱스 | 교차 확인용 상세 후보를 만들 뿐 단독 공개 출처가 아닙니다. |

수집기는 로그인, CAPTCHA, 관리자/API 경로, 접근 제어 우회를 하지 않습니다. 출처의 대회 상세 문맥에 명시된 공식 홈페이지, 홈페이지 필드, Event/organizer 구조화 URL, `신청하기`/`참가 신청하기`/`접수` 링크만 traversal evidence가 될 수 있습니다. 일반 외부 링크, SNS, 결제, 파일, generic 포털, private/admin/API/source self-link, wrong-race 페이지, 404, 사용할 수 없는 페이지는 실패나 거절로 기록되고 공개 필드가 되지 않습니다. 공개 필드가 공식 페이지에 없으면 추측하지 않고 필드 계약의 빈 값으로 남깁니다. 예외는 소유 MarathonGo 상세와 외부 공식 페이지가 이미 같은 대회로 검증된 경우의 누락된 개최일·장소뿐이며, 공식 페이지 값과 충돌하면 거절하고 이름·코스·참가비·마감일·로고·URL은 절대 보충하지 않습니다.

## 공개 데이터 계약

`races.json`은 다음을 포함합니다.

- 공식 페이지에서 확인된 대회명, 개최일, 접수 마감일, 장소, 지역
- 공식 페이지에서 확인된 코스(`풀`, `하프`, `10K`, `5K`)와 코스별 참가비
- 코스가 공개되지 않으면 빈 배열, 코스는 확인되지만 참가비가 없으면 `null`
- 공식 페이지에서 확인한 안전한 신청 URL 또는 받아들인 공식 페이지 URL인 `applicationUrl`과, 신원 검증을 통과한 경우에만 추가되는 선택적 `officialSiteUrl`
- 해당 대회와 이름·개최일이 일치하고 안전한 HTTPS 주소로 확인된 경우에만 추가되는 선택적 `logoUrl` (없거나 일반 사이트 로고·favicon이면 생략)
- 출처 배열, 검증 상태, 마지막 확인 시각, 접수 상태
- 생성 시각과 9개 일정 출처 및 `official-sites` 보강 단계의 `attempted`, `succeeded`, `recordCount`, `message`

사이트는 생성 시각을 표시하고, 일부 출처가 실패하면 화면에 해당 출처를 명시합니다. 등록 전에는 반드시 주최 측 신청 링크에서 최신 정보를 확인해야 합니다.

수집 중 출처 상세 URL, 공식 씨앗 URL, 신청 씨앗 URL은 여러 출처의 같은 대회인지 판별하는 데 쓰일 수 있지만, 출처 URL과 신청 씨앗 URL은 `races.json`에 게시하지 않습니다. 수집 사이트 홈·목록, 출처 상세의 신청 링크, 여러 대회가 공유하는 운영사 홈페이지도 `applicationUrl`로 게시하지 않습니다.

MarathonGo 소유 상세 날짜·장소가 실제로 누락 필드를 보충한 경우에만 공개 `sources`에 `marathongo`가 `official-sites`와 함께 추가됩니다. 공식 페이지가 날짜·장소를 완전하게 제공하고 값이 일치하면 공식 값이 이기며 `sources`는 `official-sites`만 유지합니다. 소유 상세 URL과 `sourceDetailUrl`은 직렬화하지 않습니다.

`official-sites` 메타데이터의 `recordCount`는 공식 페이지에서 받아들인 보강 건수입니다. `message`의 키는 정확히 `seed`, `fetched`, `accepted`, `rejected`, `policyRejected`, `fetchRejected`, `identityRejected`, `depthSkipped`, `cycleSkipped`, `hostBudgetSkipped`, `runBudgetSkipped`입니다. 일반 후보 거절은 `succeeded`를 `false`로 만들지 않습니다. `succeeded`는 보강 단계 자체가 완료됐는지를 나타내며, fixture 인덱스 초기화나 단계 설정·실행 실패 때만 `false`가 될 수 있습니다. 이는 9개 어댑터의 추출 건수를 뜻하지 않습니다.

홈페이지와 캘린더는 운영체제의 `prefers-color-scheme: dark` 설정을 따릅니다. 다크 모드는 네이비 계열 캔버스·상승 표면·테두리·썸네일 토큰을 함께 전환하며, 본문·대회 링크·필터 컨트롤은 WCAG AA 명암비를 유지합니다.

홈페이지 히어로의 현재 날씨와 대기질은 브라우저에서 [Open-Meteo](https://open-meteo.com/)로 직접 요청하며 API 키나 서버를 사용하지 않습니다. 이 browser-side Open-Meteo API는 버린 공공데이터 수집 API와 별개입니다. 패널에 위치 사용 안내를 먼저 표시한 뒤 세션당 한 번 낮은 정확도의 위치 권한을 요청하고, 허용된 좌표는 소수 둘째 자리로 줄여 Open-Meteo 날씨·대기질과 [OpenStreetMap Nominatim](https://nominatim.org/) 도시 조회에 전송합니다. 좌표 자체는 화면·로그·저장소·쿠키에 남기지 않으며, Nominatim에서 받은 시·군·구 이름만 OpenStreetMap 출처와 함께 표시합니다. 권한 거부, 시간 초과, 위치 미지원 시 고정된 `서울특별시 중구 · 서울 기준`을 사용하고 Nominatim은 호출하지 않습니다. 도시 또는 대기질 응답 실패는 각각 해당 정보만 생략하며, 필수 날씨 응답 실패도 대회 목록과 캘린더를 막지 않고 패널 안에서만 안내합니다.

공개 `Race`는 공식 페이지 신원 검증이 끝난 뒤 새로 만들어집니다. 공식 페이지는 대회명과 개최일 신원 검증을 통과해야 하며, 장소 같은 필수 필드가 없으면 닫힌 상태로 거절됩니다. `applicationUrl`은 받아들인 공식 페이지 안에서 파싱한 안전한 참가 신청 URL을 우선 사용하고, 없으면 받아들인 공식 페이지 URL을 사용합니다. 공용 정책은 자격 증명, localhost·`.local`, 비공개·루프백·링크 로컬 IP 리터럴, 전용 결제 호스트와 결제·체크아웃·청구·구매 경로를 거부합니다. 공식 페이지 정책은 여기에 더해 확장자 유무와 관계없이 정확한 신청 목적지(`register`, `apply`, `entry`, `signup`, `join` 등)를 공식 페이지 URL로 거부합니다. 최종 공식 페이지는 HTTPS를 선호하지만, URL 목적, DNS, 공개 IP, 리디렉션, 콘텐츠, 신원, 필드 검증을 모두 통과한 HTTP 페이지도 허용합니다.

DNS 확인, 공개 IP 고정, 리디렉션 재검증은 라이브 원격 공식 페이지 로더에만 적용됩니다. Fixture 모드는 로컬 테스트 파일을 신뢰하되 매핑 대상이 `tests/fixtures/official-sites/` 밖으로 나가지 못하게 제한하며 네트워크를 사용하지 않습니다.

수집 파이프라인은 Public Data/ODCloud API, CSV fallback, service key, GitHub Secrets, production browser scraper, database, server를 사용하지 않습니다. 배포 workflow는 Pages artifact workflow 그대로이며 생성 JSON을 커밋하지 않습니다.

홈페이지의 검색·지역·코스·접수 상태·초기화와 즐겨찾기는 향후 승인을 위한 읽기 전용/비활성 미리보기이며 저장하거나 목록을 바꾸지 않습니다. 홈페이지의 연도·월 선택기는 처음에 모든 월 구간을 표시합니다. 연도 선택은 해당 연도만, 월 선택은 선택 연도 안의 같은 월 또는 `전체 연도`에서 여러 연도의 같은 월을 표시하며, 연도를 바꾸면 월은 `전체 월`로 돌아갑니다. 숨긴 월 구간도 DOM에 유지하고 구체적인 연도나 월을 선택하면 첫 결과 제목으로 초점을 옮깁니다. 데이터가 없으면 두 선택기를 정직한 빈 옵션과 함께 비활성화하며, 데이터 갱신 시각은 두 선택기 아래에 표시합니다. `#/calendar`는 홈페이지와 같은 네이비·오렌지 브랜드 헤더와 흰색 상승 표면을 사용하며, 항상 보이는 `메인으로 돌아가기` 링크로 기본 홈페이지에 돌아갑니다. 지역·코스·접수 상태 필터는 빈 값을 전체로 취급하고 선택 조건을 정확한 AND로 적용하며, 초기화는 표시 월을 보존합니다. 대회 행과 캘린더 이벤트 링크는 `officialSiteUrl`이 있을 때만 공식 홈페이지로 연결합니다. `officialSiteUrl`이 없으면 대회 내용은 비클릭 텍스트로 표시하고 hover, focus, click affordance를 주지 않습니다. `applicationUrl`은 받아들인 공식 등록 또는 공식 페이지 데이터로 남지만 UI href로 쓰지 않습니다.

## 로컬 실행

```bash
bun install --frozen-lockfile

# 고정 HTML로 오프라인 수집 및 JSON 생성
bun run collect -- --fixture tests/fixtures
bun run validate
bun run build

# 품질 확인
bun run typecheck
bun run lint
bun test
bun run test
bun run test:e2e

# 정적 사이트 미리보기
bun run preview
```

실제 공개 목록을 수집하려면 `bun run collect`를 실행합니다. 각 출처 실패는 `races.json`의 `collectionMetadata`에 기록되며, 다른 출처의 결과를 막지 않습니다.

## GitHub Pages 설정

1. 이 프로젝트를 GitHub 저장소의 기본 브랜치에 올립니다.
2. **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택합니다.
3. **Actions → Collect and deploy marathon calendar → Run workflow**로 첫 배포를 수동 실행합니다.
4. 성공 후 Actions 출력의 Pages URL을 열어 홈페이지, `#/calendar`, `races.json`을 확인합니다. 글꼴 CSS·WOFF2·favicon은 모두 상대 URL이므로 저장소 하위 Pages 경로에서 같은 프로젝트 범위로 로드됩니다.

원격 Pages의 OIDC 배포, push 자동 배포, 예약 실행은 GitHub에서만 확인할 수 있습니다. 워크플로는 `contents: read`만 사용하며, 배포 작업에만 `pages: write`와 `id-token: write`를 부여합니다.

## 품질 기준

- 모든 파서는 실제 네트워크가 아닌 고정 HTML/XML 테스트 자료로 검증합니다.
- TypeScript 엄격 검사, Biome, Bun 테스트 러너와 Vitest, JSON 스키마 검증, Vite 생산 빌드를 실행합니다.
- UI 토큰·상태·반응형 규칙은 [DESIGN.md](./DESIGN.md)에 정의합니다.

## 인수인계 문서

- [ARCHITECTURE.md](./ARCHITECTURE.md): 구성요소, 데이터 계약, 배포 경계
- [OPERATIONS.md](./OPERATIONS.md): Actions·Pages 설정과 일상 운영 절차
- [DEVELOPMENT.md](./DEVELOPMENT.md): 파일별 책임, 테스트 방식, 다음 개발 작업
- [STATUS.md](./STATUS.md): 이 작업 세션의 실제 검증 결과와 알려진 제한

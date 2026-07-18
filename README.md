# Marathon Calendar

GitHub Actions가 국내 마라톤 공개 일정을 수집하고, 정규화한 `races.json`과 월별 캘린더를 GitHub Pages에 배포하는 정적 사이트입니다. 지속 실행 서버, 데이터베이스, Google 계정 자격 증명은 사용하지 않습니다.

## 데이터 흐름

1. Actions가 매일 06:20 UTC와 수동 실행 시 수집을 시작합니다.
2. 8개 공개 출처를 순차적으로 확인하고, 출처별 요청 결과와 대회에 명시적으로 연결된 공식 홈페이지·참가 신청 링크 후보를 별도로 수집합니다.
3. 대회명·개최일·장소를 보수적으로 기준 삼아 중복을 합친 뒤, 오늘 이후 대회의 공식 홈페이지 후보만 확인합니다.
4. 공식 페이지 후보 로더 호출은 실행당 최대 40회입니다. 이 값은 후보 로더 호출 예산이며 대회 수 제한이 아닙니다. 라이브 로더는 최대 2회 리디렉션을 각각 검증하므로 로더 호출 1회가 최대 3회의 원격 전송 요청을 만들 수 있습니다. 보강 실패·예산 소진·과거 대회를 포함한 모든 중복 제거 결과를 계속 게시합니다.
5. `public/races.json`을 생성하고 Vite가 이를 `dist/`에 포함합니다.
6. Pages 아티팩트만 배포합니다. 생성 JSON은 커밋하지 않습니다.

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

수집기는 로그인, CAPTCHA, 관리자/API 경로, 접근 제어 우회를 하지 않습니다. 출처의 대회 상세 문맥에 명시된 공식 홈페이지 링크만 후보로 취급하고, 일반 외부 링크·SNS·결제·파일 링크는 제외합니다. `참가신청` 링크는 신청 주소 후보일 뿐 공식 페이지로 방문하지 않습니다. 필드가 공개 페이지에 없으면 추측하지 않고 `null` 또는 안내 메모로 남깁니다.

## 공개 데이터 계약

`races.json`은 다음을 포함합니다.

- 대회명, 개최일, 접수 마감일, 장소, 지역
- 공개 페이지에서 확인된 코스(`풀`, `하프`, `10K`, `5K`)와 코스별 참가비
- 코스가 공개되지 않으면 빈 배열, 코스는 확인되지만 참가비가 없으면 `null`
- 기존 `applicationUrl`과, 신원 검증을 통과한 경우에만 추가되는 선택적 `officialSiteUrl`
- 출처 배열, 검증 상태, 마지막 확인 시각, 접수 상태
- 생성 시각과 8개 출처 및 `official-sites` 보강 단계의 `attempted`, `succeeded`, `recordCount`, `message`

사이트는 생성 시각을 표시하고, 일부 출처가 실패하면 화면에 해당 출처를 명시합니다. 등록 전에는 반드시 주최 측 신청 링크에서 최신 정보를 확인해야 합니다.

`official-sites` 메타데이터의 `recordCount`는 공식 페이지에서 받아들인 보강 건수입니다. `message`의 `candidate`, `fetched`, `accepted`, `rejected`, `budgetSkipped`는 각각 검토 대상 후보, 후보 로더 호출, 신원 검증 통과, 일반 후보 로드·파싱·신원 거절, 예산으로 건너뛴 후보 수입니다. 일반 후보 거절은 `succeeded`를 `false`로 만들지 않습니다. `succeeded`는 보강 단계 자체가 완료됐는지를 나타내며, fixture 인덱스 초기화나 단계 설정·실행 실패 때만 `false`가 될 수 있습니다. 이는 8개 어댑터의 추출 건수를 뜻하지 않습니다.

공식 페이지에 없는 필드는 현재 대회 값을 유지합니다. 다만 공식 페이지 로드 전에도 공용 비결제 HTTP(S) 정책을 통과한 명시적 참가 신청 후보가 `applicationUrl`을 갱신할 수 있습니다. 신원 검증을 통과한 공식 페이지는 명시된 장소·마감일·코스·가격·신청 링크를 우선순위 규칙에 따라 합치고, 공식 페이지 정책을 통과한 최종 페이지를 `officialSiteUrl`로 기록하며 검증 상태, 검증·수정 시각, 접수 상태를 갱신합니다. 대회명과 개최일은 바꾸지 않습니다. 공용 정책은 자격 증명, localhost·`.local`, 비공개·루프백·링크 로컬 IP 리터럴, 전용 결제 호스트와 결제·체크아웃·청구·구매 경로를 거부합니다. 공식 페이지 정책은 여기에 더해 확장자 유무와 관계없이 정확한 신청 목적지(`register`, `apply`, `entry`, `signup`, `join` 등)를 거부하지만, 해당 URL은 `applicationUrl`로 계속 게시할 수 있습니다.

DNS 확인, 공개 IP 고정, 리디렉션 재검증은 라이브 원격 공식 페이지 로더에만 적용됩니다. Fixture 모드는 로컬 테스트 파일을 신뢰하되 매핑 대상이 `tests/fixtures/official-sites/` 밖으로 나가지 못하게 제한하며 네트워크를 사용하지 않습니다.

지역·코스·접수 상태 필터는 빈 값을 전체로 취급하고 선택된 조건을 정확한 AND로 적용합니다. 필터 변경과 초기화는 현재 표시 월을 바꾸지 않으며, 월 이동은 이전/다음 버튼으로만 수행합니다. 대회 카드는 검증된 `officialSiteUrl`을 우선하고 없으면 `applicationUrl`을 사용합니다.

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

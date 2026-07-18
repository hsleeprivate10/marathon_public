const sourceLabels: Readonly<Record<string, string>> = {
  gorunning: "고러닝",
  kormarathon: "전국마라톤협회",
  emarathon: "이마라톤",
  maedal: "매달",
  kaaf: "대한육상연맹",
  marathonmoa: "마라톤모아",
  runningmap: "러닝맵",
  marathonmate: "마라톤메이트",
  "official-sites": "공식 대회 사이트",
};

export function failedSourceNames(sourceIds: readonly string[]): readonly string[] {
  return [...new Set(sourceIds.map((sourceId) => sourceLabels[sourceId] ?? "기타 일정 출처"))];
}

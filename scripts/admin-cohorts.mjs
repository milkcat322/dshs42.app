// ============================================================
// 관리자 사이트 기수별 설정 (42기 · 43기)
// scripts/build-admin.mjs 가 이 값으로 cohort.js(window.DSHS_COHORT)를 만들고, deploy-admin.mjs 가 올릴 저장소를 고릅니다.
// 관리자 사이트 코드(admin/)는 하나이고, 기수에 따라 보이는 학생 · 과목만 달라집니다 (같은 Supabase DB).
// ============================================================

// 43기 과목 (cohort43.sql 의 cohort43_subjects 와 같게). 43기는 분반이 없어 모두 '전체 분반'(ban 없음)
// '체육'은 42기 과목 이름과 같습니다 (두 기수 모두 수행평가를 받지 않는 과목이라 공지가 섞일 일은 없음).
// 그래서 42기 관리 화면에서 43기 과목을 뺄 때 '체육'은 빼지 않습니다.
export const SUBJECTS_43 = [
  "국어", "영어회화", "지구과학", "진로", "체육", "화학",
  "적분과 통계", "기하와 벡터", "물리", "한국사", "프로그래밍", "생명과학",
];
const SHARED_SUBJECTS = ["체육"];

export const COHORTS = {
  42: {
    out: "admin-dist",                                       // 묶은 결과 폴더
    work: ".admin-deploy",                                   // 배포할 때 관리자 저장소를 받아 두는 곳
    repo: "https://github.com/milkcat322/dshs42-admin.git",
    site: "dshs42.app",
    schoolData: true,                                        // 학생 index.html 의 SCHOOL_DATA(42기 시간표 · 명단)를 넣음
    config: null,                                            // config.js 를 그대로 복사
    manifestId: null,                                        // 예전 manifest 그대로 (설치한 앱이 바뀌지 않게)
    cohort: {
      id: 42, label: "42기", title: "dshs42 관리",
      min: 2000, max: 2999,
      // 42기는 예전부터 보이던 것을 그대로 두고 다른 기수(43기) 학번 · 과목만 뺍니다
      strict: false, otherRanges: [[1000, 1999]], subjects: null, otherSubjects: SUBJECTS_43.filter((s) => !SHARED_SUBJECTS.includes(s)),
      noAsgSubjects: ["미술", "체육"],
      grade: null,                                           // 명단(SCHOOL_DATA)에서 (2026년 2학년)
      studentUrl: "https://dshs42.app",
      academicUrl: "https://dshs42-beta.netlify.app/academic.json",
      // 이미 등록한 42기 관리자 기기가 로그인된 채로 남게 예전 이름 그대로
      keys: { auth: "dshs42-admin-auth", school: "dshs42-admin-school", push: "dshs42-admin-push", fbSeen: "dshs-fb-seen", ovSeen: "dshs-overview-seen" },
    },
  },
  43: {
    out: "admin-dist-43",
    work: ".admin-deploy-43",
    repo: "https://github.com/milkcat322/dshs43-admin.git",
    site: "dshs43.app",
    schoolData: false,                                       // 43기는 시간표가 없어 빈 SCHOOL_DATA → 명단은 DB 에서
    // 43기 학생 사이트 주소는 Netlify 주소입니다 (dshs43.app 도메인은 사지 않음)
    config: {
      ADMIN_URL: "https://dshs43-admin.netlify.app",
      STUDENT_URL: "https://dshs43.netlify.app",
      ACADEMIC_URL: "https://dshs43.netlify.app/academic.json",
    },
    manifestId: "dshs43-admin",
    cohort: {
      id: 43, label: "43기", title: "dshs43 관리",
      min: 1000, max: 1999,
      strict: true, otherRanges: [[2000, 2999]], subjects: SUBJECTS_43, otherSubjects: [],
      noAsgSubjects: ["체육"],                               // 43기 학생 사이트의 NO_ASG_SUBJECTS 와 같게
      grade: 1,                                              // 2026년 1학년
      studentUrl: "https://dshs43.netlify.app",
      academicUrl: "https://dshs43.netlify.app/academic.json", // 43기 저장소의 _headers 가 다른 주소 읽기를 허락
      keys: { auth: "dshs43-admin-auth", school: "dshs43-admin-school", push: "dshs43-admin-push", fbSeen: "dshs43-fb-seen", ovSeen: "dshs43-overview-seen" },
    },
  },
};

// 명령줄에서 기수 고르기: --cohort 43 또는 --cohort=43 (없으면 42)
export function pickCohort(argv = process.argv.slice(2)) {
  let id = "42";
  argv.forEach((a, i) => {
    if (a === "--cohort") id = argv[i + 1];
    else if (a.startsWith("--cohort=")) id = a.slice(9);
  });
  const c = COHORTS[id];
  if (!c) throw new Error(`모르는 기수예요: ${id} (42 또는 43)`);
  return { id: +id, ...c };
}

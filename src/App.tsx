import { useEffect, useMemo, useState } from "react";
import questionsJson from "./data/questions.json";
import type {
  CategoryStat,
  Feedback,
  Question,
  QuestionStat,
  QuestionsPayload,
  QuizResults,
  Session,
  ThemePreference
} from "./types";

const STORAGE_RESULTS_KEY = "its_mas_quiz_static_results_v1";
const STORAGE_THEME_KEY = "its_mas_quiz_theme_v1";
const THEME_SEQUENCE: ThemePreference[] = ["system", "light", "dark"];
const MAX_LIMIT = 100;
const MAX_SAVED_SESSIONS = 200;
const MAX_ERROR_HISTORY = 100;
const RECENT_SESSIONS_LIMIT = 8;

function nowIso(): string {
  return new Date().toISOString();
}

function toNonEmptyString(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : fallback;
}

function toNonNegativeInt(value: unknown): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function clampPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const parsed = Math.floor(value);
  if (parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, MAX_LIMIT);
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function defaultQuestionStat(): QuestionStat {
  return {
    seen: 0,
    correct: 0,
    wrong: 0,
    consecutiveCorrect: 0,
    mastered: false,
    lastResult: null,
    lastAnsweredAt: null
  };
}

function defaultResults(theme: ThemePreference = "system"): QuizResults {
  const timestamp = nowIso();
  return {
    createdAt: timestamp,
    updatedAt: timestamp,
    sessions: [],
    questionStats: {},
    errorPoolHistory: [],
    preferences: {
      theme
    }
  };
}

function normalizeQuestion(raw: unknown, index: number): Question {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const id = toNonEmptyString(source.id, `q${String(index + 1).padStart(4, "0")}`);
  const question = toNonEmptyString(source.question, "Unbenannte Frage");
  const category = toNonEmptyString(source.category ?? source.topic, "Allgemein");
  const explanation = toNonEmptyString(source.explanation, "Keine Erklaerung hinterlegt.");

  const rawOptions = Array.isArray(source.options) ? source.options : [];
  const options = rawOptions.map((entry) => toNonEmptyString(entry)).filter(Boolean);
  while (options.length < 4) {
    options.push(`Option ${options.length + 1}`);
  }
  if (options.length > 4) {
    options.length = 4;
  }

  let correct = Number.isInteger(source.correct) ? Number(source.correct) : 0;
  if (correct < 0 || correct >= options.length) {
    correct = 0;
  }

  return {
    id,
    question,
    options,
    correct,
    category,
    explanation
  };
}

const QUESTIONS_PAYLOAD = questionsJson as QuestionsPayload;
const ALL_QUESTIONS: Question[] = Array.isArray(QUESTIONS_PAYLOAD.questions)
  ? QUESTIONS_PAYLOAD.questions.map((question, index) => normalizeQuestion(question, index))
  : [];

function listAvailableCategories(questions: Question[]): string[] {
  return [...new Set(questions.map((question) => question.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "de")
  );
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function getRetryPool(questionStats: Record<string, QuestionStat>): string[] {
  return Object.entries(questionStats)
    .filter(([, stat]) => stat.wrong > 0 && !stat.mastered)
    .map(([questionId]) => questionId);
}

function buildSummary(results: QuizResults, retryPool: string[]) {
  const totalAnswers = results.sessions.reduce((sum, session) => sum + session.totalAnswers, 0);
  const correctAnswers = results.sessions.reduce((sum, session) => sum + session.correctAnswers, 0);
  const wrongAnswers = totalAnswers - correctAnswers;
  const masteredQuestions = Object.values(results.questionStats).filter((stat) => stat.mastered).length;
  const accuracyPercent = totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0;
  const lastSession = results.sessions.length > 0 ? results.sessions[results.sessions.length - 1] : null;

  return {
    totalSessions: results.sessions.length,
    totalAnswers,
    correctAnswers,
    wrongAnswers,
    accuracyPercent,
    masteredQuestions,
    retryPoolSize: retryPool.length,
    lastSessionAt: lastSession ? lastSession.submittedAt : null
  };
}

function buildCategoryStats(questionStats: Record<string, QuestionStat>, questions: Question[]): CategoryStat[] {
  const byCategory = new Map<string, CategoryStat>();

  for (const question of questions) {
    const stat = questionStats[question.id];
    if (!stat || stat.seen <= 0) {
      continue;
    }

    const key = question.category || "Allgemein";
    if (!byCategory.has(key)) {
      byCategory.set(key, {
        category: key,
        seen: 0,
        correct: 0,
        wrong: 0,
        mastered: 0,
        accuracyPercent: 0
      });
    }

    const bucket = byCategory.get(key);
    if (!bucket) {
      continue;
    }
    bucket.seen += stat.seen;
    bucket.correct += stat.correct;
    bucket.wrong += stat.wrong;
    bucket.mastered += stat.mastered ? 1 : 0;
  }

  const categories = [...byCategory.values()];
  for (const category of categories) {
    category.accuracyPercent = category.seen > 0 ? Math.round((category.correct / category.seen) * 100) : 0;
  }

  categories.sort((a, b) => b.seen - a.seen || a.category.localeCompare(b.category, "de"));
  return categories;
}

function formatDateTime(iso: string | null): string {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("de-DE");
}

function readThemePreference(): ThemePreference | null {
  if (typeof window === "undefined") {
    return null;
  }
  const stored = window.localStorage.getItem(STORAGE_THEME_KEY);
  return isThemePreference(stored) ? stored : null;
}

function normalizeQuestionStat(raw: unknown): QuestionStat {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  return {
    seen: toNonNegativeInt(source.seen),
    correct: toNonNegativeInt(source.correct),
    wrong: toNonNegativeInt(source.wrong),
    consecutiveCorrect: toNonNegativeInt(source.consecutiveCorrect),
    mastered: Boolean(source.mastered),
    lastResult: source.lastResult === "correct" || source.lastResult === "wrong" ? source.lastResult : null,
    lastAnsweredAt: source.lastAnsweredAt ? toNonEmptyString(source.lastAnsweredAt, "") || null : null
  };
}

function normalizeResults(raw: unknown, fallbackTheme: ThemePreference): QuizResults {
  const base = defaultResults(fallbackTheme);

  if (!raw || typeof raw !== "object") {
    return base;
  }

  const source = raw as Record<string, unknown>;
  const theme = isThemePreference((source.preferences as { theme?: unknown } | undefined)?.theme)
    ? ((source.preferences as { theme: ThemePreference }).theme as ThemePreference)
    : fallbackTheme;

  const questionStats: Record<string, QuestionStat> = {};
  if (source.questionStats && typeof source.questionStats === "object") {
    for (const [questionId, stat] of Object.entries(source.questionStats as Record<string, unknown>)) {
      const id = toNonEmptyString(questionId);
      if (!id) {
        continue;
      }
      questionStats[id] = normalizeQuestionStat(stat);
    }
  }

  const sessions: Session[] = Array.isArray(source.sessions)
    ? source.sessions
        .map((entry) => {
          const sessionSource = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
          if (!sessionSource) {
            return null;
          }

          const answers = Array.isArray(sessionSource.answers)
            ? sessionSource.answers
                .map((answerEntry) => {
                  const answer =
                    answerEntry && typeof answerEntry === "object" ? (answerEntry as Record<string, unknown>) : null;
                  if (!answer) {
                    return null;
                  }
                  return {
                    questionId: toNonEmptyString(answer.questionId),
                    category: toNonEmptyString(answer.category, "Allgemein"),
                    selectedIndex: toNonNegativeInt(answer.selectedIndex),
                    correctIndex: toNonNegativeInt(answer.correctIndex),
                    isCorrect: Boolean(answer.isCorrect)
                  };
                })
                .filter((answer): answer is Session["answers"][number] => Boolean(answer && answer.questionId))
            : [];

          const totalAnswers = toNonNegativeInt(sessionSource.totalAnswers);
          const correctAnswers = toNonNegativeInt(sessionSource.correctAnswers);
          const wrongAnswers = totalAnswers >= correctAnswers ? totalAnswers - correctAnswers : toNonNegativeInt(sessionSource.wrongAnswers);
          const scorePercent =
            totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : toNonNegativeInt(sessionSource.scorePercent);

          return {
            id: toNonEmptyString(sessionSource.id, `s_${Date.now()}`),
            submittedAt: toNonEmptyString(sessionSource.submittedAt, nowIso()),
            totalAnswers,
            correctAnswers,
            wrongAnswers,
            scorePercent,
            retryMode: Boolean(sessionSource.retryMode),
            answers
          };
        })
        .filter((session): session is Session => Boolean(session))
    : [];

  const errorPoolHistory = Array.isArray(source.errorPoolHistory)
    ? source.errorPoolHistory
        .map((entry) => {
          const history = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
          if (!history) {
            return null;
          }
          return {
            at: toNonEmptyString(history.at, nowIso()),
            questionIds: Array.isArray(history.questionIds)
              ? history.questionIds.map((id) => toNonEmptyString(id)).filter(Boolean)
              : []
          };
        })
        .filter((entry): entry is QuizResults["errorPoolHistory"][number] => Boolean(entry))
    : [];

  return {
    createdAt: toNonEmptyString(source.createdAt, base.createdAt),
    updatedAt: toNonEmptyString(source.updatedAt, base.updatedAt),
    sessions,
    questionStats,
    errorPoolHistory,
    preferences: {
      theme
    }
  };
}

function loadBootstrapState() {
  const fallbackTheme = readThemePreference() ?? "system";
  if (typeof window === "undefined") {
    const results = defaultResults(fallbackTheme);
    return { results, theme: fallbackTheme };
  }

  const raw = window.localStorage.getItem(STORAGE_RESULTS_KEY);
  const parsed = raw ? normalizeResults(safeParseJson(raw), fallbackTheme) : defaultResults(fallbackTheme);
  const theme = readThemePreference() ?? parsed.preferences.theme;

  if (parsed.preferences.theme !== theme) {
    parsed.preferences.theme = theme;
    parsed.updatedAt = nowIso();
  }

  return {
    results: parsed,
    theme
  };
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persistResults(results: QuizResults) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_RESULTS_KEY, JSON.stringify(results));
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(themePreference: ThemePreference): "light" | "dark" {
  return themePreference === "system" ? getSystemTheme() : themePreference;
}

function applyTheme(themePreference: ThemePreference) {
  if (typeof document === "undefined") {
    return;
  }
  document.body.dataset.theme = resolveTheme(themePreference);
}

function cycleTheme(current: ThemePreference): ThemePreference {
  const index = THEME_SEQUENCE.indexOf(current);
  if (index < 0) {
    return "system";
  }
  return THEME_SEQUENCE[(index + 1) % THEME_SEQUENCE.length];
}

function selectQuestions(
  questions: Question[],
  results: QuizResults,
  options: {
    limit: number;
    category: string;
    retryMode: boolean;
  }
): Question[] {
  const normalizedCategory = options.category.trim().toLowerCase();

  let filtered = questions;
  if (normalizedCategory) {
    filtered = filtered.filter((question) => question.category.toLowerCase() === normalizedCategory);
  }

  if (options.retryMode) {
    filtered = filtered.filter((question) => {
      const stat = results.questionStats[question.id];
      return Boolean(stat && stat.wrong > 0 && !stat.mastered);
    });
  }

  return shuffle(filtered).slice(0, options.limit);
}

function scoreAndPersistSession(params: {
  questions: Question[];
  answers: Record<string, number>;
  retryMode: boolean;
  previousResults: QuizResults;
}) {
  const now = nowIso();
  let correctAnswers = 0;
  const detailedAnswers: Session["answers"] = [];
  const masteredQuestionIds: string[] = [];
  const nextQuestionStats: Record<string, QuestionStat> = { ...params.previousResults.questionStats };

  for (const question of params.questions) {
    const selectedIndex = params.answers[question.id];
    if (!Number.isInteger(selectedIndex)) {
      throw new Error(`Frage ${question.id} hat keine gueltige Antwort.`);
    }

    if (selectedIndex < 0 || selectedIndex >= question.options.length) {
      throw new Error(`Antwortindex ausserhalb des Bereichs bei Frage ${question.id}.`);
    }

    const isCorrect = selectedIndex === question.correct;
    if (isCorrect) {
      correctAnswers += 1;
    }

    const previous = nextQuestionStats[question.id] ? { ...nextQuestionStats[question.id] } : defaultQuestionStat();
    const wasMastered = previous.mastered;

    previous.seen += 1;
    previous.lastAnsweredAt = now;
    previous.lastResult = isCorrect ? "correct" : "wrong";

    if (isCorrect) {
      previous.correct += 1;
      previous.consecutiveCorrect += 1;
      if (previous.consecutiveCorrect >= 3) {
        previous.mastered = true;
      }
    } else {
      previous.wrong += 1;
      previous.consecutiveCorrect = 0;
      previous.mastered = false;
    }

    if (!wasMastered && previous.mastered) {
      masteredQuestionIds.push(question.id);
    }

    nextQuestionStats[question.id] = previous;

    detailedAnswers.push({
      questionId: question.id,
      category: question.category,
      selectedIndex,
      correctIndex: question.correct,
      isCorrect
    });
  }

  const totalAnswers = params.questions.length;
  const wrongAnswers = totalAnswers - correctAnswers;
  const scorePercent = totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0;
  const retryPool = getRetryPool(nextQuestionStats);

  const session: Session = {
    id: `s_${Date.now()}`,
    submittedAt: now,
    totalAnswers,
    correctAnswers,
    wrongAnswers,
    scorePercent,
    retryMode: params.retryMode,
    answers: detailedAnswers
  };

  const sessions = [...params.previousResults.sessions, session].slice(-MAX_SAVED_SESSIONS);
  const errorPoolHistory = [...params.previousResults.errorPoolHistory, { at: now, questionIds: retryPool }].slice(
    -MAX_ERROR_HISTORY
  );

  const nextResults: QuizResults = {
    ...params.previousResults,
    updatedAt: now,
    sessions,
    questionStats: nextQuestionStats,
    errorPoolHistory
  };

  return {
    nextResults,
    session,
    masteredQuestionIds,
    retryPoolSize: retryPool.length
  };
}

export default function App() {
  const [bootstrap] = useState(loadBootstrapState);
  const [results, setResults] = useState<QuizResults>(bootstrap.results);
  const [themePreference, setThemePreference] = useState<ThemePreference>(bootstrap.theme);

  const [limit, setLimit] = useState<number>(10);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [retryMode, setRetryMode] = useState<boolean>(false);

  const [activeQuestions, setActiveQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [feedbackByQuestionId, setFeedbackByQuestionId] = useState<Record<string, Feedback>>({});

  const [notice, setNotice] = useState<string>(
    "Bereit. Diese Version laeuft komplett statisch im Browser und braucht keinen Server."
  );
  const [latestSession, setLatestSession] = useState<Session | null>(null);

  const availableCategories = useMemo(() => listAvailableCategories(ALL_QUESTIONS), []);

  const retryPool = useMemo(() => getRetryPool(results.questionStats), [results.questionStats]);
  const summary = useMemo(() => buildSummary(results, retryPool), [results, retryPool]);
  const categoryStats = useMemo(() => buildCategoryStats(results.questionStats, ALL_QUESTIONS), [results.questionStats]);
  const recentSessions = useMemo(() => results.sessions.slice(-RECENT_SESSIONS_LIMIT).reverse(), [results.sessions]);

  const answeredCount = Object.keys(answers).length;
  const progressPercent = activeQuestions.length > 0 ? Math.round((answeredCount / activeQuestions.length) * 100) : 0;

  const currentQuestion = activeQuestions[currentIndex] ?? null;
  const currentFeedback = currentQuestion ? feedbackByQuestionId[currentQuestion.id] : null;
  const selectedOptionIndex = currentQuestion ? answers[currentQuestion.id] : undefined;

  useEffect(() => {
    applyTheme(themePreference);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_THEME_KEY, themePreference);
    }

    setResults((previous) => {
      if (previous.preferences.theme === themePreference) {
        return previous;
      }
      return {
        ...previous,
        updatedAt: nowIso(),
        preferences: {
          ...previous.preferences,
          theme: themePreference
        }
      };
    });
  }, [themePreference]);

  useEffect(() => {
    persistResults(results);
  }, [results]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (themePreference === "system") {
        applyTheme("system");
      }
    };

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, [themePreference]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (activeQuestions.length === 0 || !currentQuestion) {
        return;
      }

      if (event.key === "ArrowRight") {
        setCurrentIndex((previous) => Math.min(previous + 1, activeQuestions.length - 1));
        return;
      }

      if (event.key === "ArrowLeft") {
        setCurrentIndex((previous) => Math.max(previous - 1, 0));
        return;
      }

      if (/^[1-4]$/.test(event.key)) {
        const optionIndex = Number.parseInt(event.key, 10) - 1;
        if (optionIndex >= currentQuestion.options.length) {
          return;
        }
        setAnswers((previous) => ({
          ...previous,
          [currentQuestion.id]: optionIndex
        }));
        setFeedbackByQuestionId((previous) => ({
          ...previous,
          [currentQuestion.id]: {
            isCorrect: optionIndex === currentQuestion.correct,
            explanation: currentQuestion.explanation
          }
        }));
      }
    };

    document.addEventListener("keydown", handleKeyboard);
    return () => document.removeEventListener("keydown", handleKeyboard);
  }, [activeQuestions, currentQuestion]);

  const startQuiz = () => {
    const normalizedLimit = clampPositiveInt(limit, 10);
    setLimit(normalizedLimit);

    const selected = selectQuestions(ALL_QUESTIONS, results, {
      limit: normalizedLimit,
      category: selectedCategory,
      retryMode
    });

    setActiveQuestions(selected);
    setCurrentIndex(0);
    setAnswers({});
    setFeedbackByQuestionId({});
    setLatestSession(null);

    if (selected.length === 0) {
      setNotice("Keine Fragen fuer die aktuelle Filterkombination gefunden. Passe Kategorie oder Retry-Mode an.");
      return;
    }

    setNotice(
      `Quiz geladen: ${selected.length} Frage(n) (${retryMode ? "Retry-Mode" : "Standard"}${
        selectedCategory ? `, Kategorie: ${selectedCategory}` : ""
      }).`
    );
  };

  const selectAnswer = (optionIndex: number) => {
    if (!currentQuestion) {
      return;
    }

    setAnswers((previous) => ({
      ...previous,
      [currentQuestion.id]: optionIndex
    }));

    setFeedbackByQuestionId((previous) => ({
      ...previous,
      [currentQuestion.id]: {
        isCorrect: optionIndex === currentQuestion.correct,
        explanation: currentQuestion.explanation
      }
    }));
  };

  const submitQuiz = () => {
    if (activeQuestions.length === 0) {
      setNotice("Bitte starte zuerst ein Quiz.");
      return;
    }

    const unanswered = activeQuestions.filter((question) => !Number.isInteger(answers[question.id]));
    if (unanswered.length > 0) {
      setNotice(`Es fehlen noch ${unanswered.length} Antwort(en), bevor du abgeben kannst.`);
      return;
    }

    try {
      const payload = scoreAndPersistSession({
        questions: activeQuestions,
        answers,
        retryMode,
        previousResults: results
      });

      setResults(payload.nextResults);
      setLatestSession(payload.session);
      const masteryText =
        payload.masteredQuestionIds.length > 0 ? `, neu mastered: ${payload.masteredQuestionIds.length}` : "";
      setNotice(
        `Session gespeichert: ${payload.session.scorePercent}% (${payload.session.correctAnswers}/${payload.session.totalAnswers}) - Retry-Pool: ${payload.retryPoolSize}${masteryText}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unbekannter Fehler beim Auswerten.";
      setNotice(message);
    }
  };

  const resetProgress = () => {
    const confirmed = window.confirm("Fortschritt wirklich loeschen?");
    if (!confirmed) {
      return;
    }

    setResults((previous) => {
      const reset = defaultResults(previous.preferences.theme);
      reset.createdAt = previous.createdAt;
      return reset;
    });

    setActiveQuestions([]);
    setCurrentIndex(0);
    setAnswers({});
    setFeedbackByQuestionId({});
    setLatestSession(null);
    setNotice("Fortschritt geloescht. Starte ein neues Quiz.");
  };

  const toggleTheme = () => {
    const nextTheme = cycleTheme(themePreference);
    setThemePreference(nextTheme);
    setNotice(`Theme gesetzt: ${nextTheme}`);
  };

  const showLatestSession = latestSession ?? (results.sessions.length > 0 ? results.sessions[results.sessions.length - 1] : null);

  return (
    <main className="app-shell">
      <header className="panel hero-panel">
        <p className="kicker">ITS-MAS Lerntrainer</p>
        <h1>Netzwerke Quiz - Static Edition</h1>
        <p className="subline">
          Vollstaendig statische Variante fuer GitHub Pages: Fragen, Fortschritt und Retry-Logik laufen lokal im Browser.
        </p>
        <div className="hero-actions">
          <button type="button" className="btn ghost" onClick={toggleTheme}>
            Theme: {themePreference}
          </button>
        </div>
      </header>

      <section className="panel control-panel">
        <div className="control-grid">
          <label>
            Fragenanzahl
            <input
              type="number"
              min={1}
              max={MAX_LIMIT}
              value={limit}
              onChange={(event) => setLimit(Number.parseInt(event.target.value, 10) || 1)}
            />
          </label>

          <label>
            Kategorie
            <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
              <option value="">Alle Kategorien</option>
              {availableCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="toggle">
            <input type="checkbox" checked={retryMode} onChange={(event) => setRetryMode(event.target.checked)} />
            Nur Fehlerpool (Retry)
          </label>

          <div className="button-row">
            <button type="button" className="btn accent" onClick={startQuiz}>
              Quiz starten
            </button>
            <button type="button" className="btn accent muted" onClick={submitQuiz} disabled={activeQuestions.length === 0}>
              Quiz auswerten
            </button>
            <button type="button" className="btn danger" onClick={resetProgress}>
              Fortschritt loeschen
            </button>
          </div>
        </div>

        <p className="notice">{notice}</p>
      </section>

      <section className="content-grid">
        <article className="panel quiz-panel">
          <div className="quiz-head">
            <h2>Frage</h2>
            <p>
              {activeQuestions.length > 0 ? `${currentIndex + 1} / ${activeQuestions.length}` : "0 / 0"}
            </p>
          </div>

          <p className="chip">{currentQuestion ? currentQuestion.category : "Keine aktive Kategorie"}</p>
          <h3 className="question-title">{currentQuestion ? currentQuestion.question : "Starte ein Quiz, um Fragen zu laden."}</h3>

          <div className="options">
            {currentQuestion
              ? currentQuestion.options.map((option, optionIndex) => {
                  const classes = ["option-btn"];
                  if (selectedOptionIndex === optionIndex) {
                    classes.push("selected");
                  }
                  if (currentFeedback) {
                    if (optionIndex === currentQuestion.correct) {
                      classes.push("correct");
                    } else if (!currentFeedback.isCorrect && selectedOptionIndex === optionIndex) {
                      classes.push("wrong");
                    }
                  }

                  return (
                    <button
                      key={`${currentQuestion.id}-${optionIndex}`}
                      type="button"
                      className={classes.join(" ")}
                      onClick={() => selectAnswer(optionIndex)}
                    >
                      <span>{optionIndex + 1}.</span>
                      <span>{option}</span>
                    </button>
                  );
                })
              : null}
          </div>

          <div className={`feedback ${currentFeedback ? (currentFeedback.isCorrect ? "ok" : "bad") : "neutral"}`}>
            {!currentFeedback && "Waehle eine Antwort fuer direktes Feedback."}
            {currentFeedback && currentFeedback.isCorrect && `Richtig. ${currentFeedback.explanation}`}
            {currentFeedback &&
              !currentFeedback.isCorrect &&
              currentQuestion &&
              `Nicht korrekt. Richtige Antwort: ${currentQuestion.options[currentQuestion.correct]}. ${currentFeedback.explanation}`}
          </div>

          <div className="nav-row">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setCurrentIndex((previous) => Math.max(previous - 1, 0))}
              disabled={currentIndex === 0 || activeQuestions.length === 0}
            >
              Zurueck
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setCurrentIndex((previous) => Math.min(previous + 1, activeQuestions.length - 1))}
              disabled={activeQuestions.length === 0 || currentIndex >= activeQuestions.length - 1}
            >
              Weiter
            </button>
          </div>

          <div className="progress-track" aria-label="Antwortfortschritt">
            <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <p className="progress-copy">Fortschritt: {answeredCount} / {activeQuestions.length || 0} beantwortet</p>
        </article>

        <article className="panel stats-panel">
          <h2>Fortschritt</h2>
          <div className="metric-grid">
            <article>
              <p className="metric-label">Sessions</p>
              <p className="metric-value">{summary.totalSessions}</p>
            </article>
            <article>
              <p className="metric-label">Accuracy</p>
              <p className="metric-value">{summary.accuracyPercent}%</p>
            </article>
            <article>
              <p className="metric-label">Retry-Pool</p>
              <p className="metric-value">{summary.retryPoolSize}</p>
            </article>
            <article>
              <p className="metric-label">Mastered</p>
              <p className="metric-value">{summary.masteredQuestions}</p>
            </article>
          </div>

          <p className="latest-session">
            {showLatestSession
              ? `Letzte Session: ${showLatestSession.scorePercent}% (${showLatestSession.correctAnswers}/${showLatestSession.totalAnswers}) am ${formatDateTime(showLatestSession.submittedAt)}`
              : summary.lastSessionAt
                ? `Zuletzt abgegeben: ${formatDateTime(summary.lastSessionAt)}`
                : "Noch keine Session abgegeben."}
          </p>

          <section className="categories">
            <h3>Top Kategorien</h3>
            {categoryStats.length === 0 && <p className="muted-copy">Noch keine Statistik vorhanden.</p>}
            {categoryStats.slice(0, 6).map((entry) => (
              <article key={entry.category} className="category-row">
                <div className="category-head">
                  <span>{entry.category}</span>
                  <span>{entry.accuracyPercent}%</span>
                </div>
                <div className="category-track">
                  <div className="category-fill" style={{ width: `${entry.accuracyPercent}%` }} />
                </div>
              </article>
            ))}
          </section>

          <section className="sessions">
            <h3>Letzte Sessions</h3>
            {recentSessions.length === 0 && <p className="muted-copy">Noch keine Sessions gespeichert.</p>}
            {recentSessions.length > 0 && (
              <div className="session-table">
                {recentSessions.map((session) => (
                  <div key={session.id} className="session-row">
                    <span>{formatDateTime(session.submittedAt)}</span>
                    <span>{session.scorePercent}%</span>
                    <span>
                      {session.correctAnswers}/{session.totalAnswers}
                    </span>
                    <span>{session.retryMode ? "Retry" : "Standard"}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </article>
      </section>
    </main>
  );
}

export type ThemePreference = "system" | "light" | "dark";

export interface Question {
  id: string;
  question: string;
  options: string[];
  correct: number;
  category: string;
  explanation: string;
}

export interface QuestionsPayload {
  generatedAt?: string;
  count?: number;
  questions: Question[];
}

export interface QuestionStat {
  seen: number;
  correct: number;
  wrong: number;
  consecutiveCorrect: number;
  mastered: boolean;
  lastResult: "correct" | "wrong" | null;
  lastAnsweredAt: string | null;
}

export interface SessionAnswer {
  questionId: string;
  category: string;
  selectedIndex: number;
  correctIndex: number;
  isCorrect: boolean;
}

export interface Session {
  id: string;
  submittedAt: string;
  totalAnswers: number;
  correctAnswers: number;
  wrongAnswers: number;
  scorePercent: number;
  retryMode: boolean;
  answers: SessionAnswer[];
}

export interface ErrorPoolHistoryEntry {
  at: string;
  questionIds: string[];
}

export interface QuizResults {
  createdAt: string;
  updatedAt: string;
  sessions: Session[];
  questionStats: Record<string, QuestionStat>;
  errorPoolHistory: ErrorPoolHistoryEntry[];
  preferences: {
    theme: ThemePreference;
  };
}

export interface Summary {
  totalSessions: number;
  totalAnswers: number;
  correctAnswers: number;
  wrongAnswers: number;
  accuracyPercent: number;
  masteredQuestions: number;
  retryPoolSize: number;
  lastSessionAt: string | null;
}

export interface CategoryStat {
  category: string;
  seen: number;
  correct: number;
  wrong: number;
  mastered: number;
  accuracyPercent: number;
}

export interface Feedback {
  isCorrect: boolean;
  explanation: string;
}

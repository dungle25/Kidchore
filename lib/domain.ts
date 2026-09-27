/**
 * Shared domain types.
 *
 * The read models mirror the JSONB shapes returned by the database functions in
 * db/migrations/0001_security_lockdown_and_rpc.sql. Keeping them in one file means
 * a change to a function's output is a single edit here plus a compiler error at
 * every consumer, instead of a silent `any`.
 */

export type UserRole = "PARENT" | "CHILD";
export type TaskStatus = "PENDING" | "SUBMITTED" | "APPROVED" | "REJECTED";
export type Recurrence = "DAILY" | "WEEKLY" | "MONTHLY" | "ONE_TIME";
export type RedemptionStatus = "REQUESTED" | "APPROVED" | "REJECTED";
export type TransactionType =
  | "TASK_COMPLETED"
  | "REWARD_REDEEMED"
  | "MANUAL_ADJUSTMENT";

/** The authenticated caller, as resolved server-side from the session. */
export interface SessionUser {
  id: string;
  familyId: string;
  role: UserRole;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  pointsBalance: number;
}

export interface KidTask {
  id: string;
  title: string;
  description: string | null;
  points_reward: number;
  require_proof_image: boolean;
  status: TaskStatus;
  due_date: string;
  proof_image_url: string | null;
  /**
   * Set when the photo was removed because it passed its retention window (migration
   * 0014). `proof_image_url` is kept, so the screen must check this before rendering the
   * image - a URL is no longer proof that the object still exists.
   */
  proof_deleted_at: string | null;
  rejection_reason: string | null;
}

/**
 * An invite for a second parent.
 *
 * There is no `code` field, and there cannot be: the database stores only a sha256 of
 * it. The plaintext exists for the length of the call that creates it.
 */
export interface FamilyInvite {
  id: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_by_name: string | null;
  accepted_by_name: string | null;
}

export interface KidDashboard {
  child: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    points_balance: number;
  };
  tasks_today: KidTask[];
  approved_total: number;
  pending_review: number;
}

export interface KidReward {
  id: string;
  title: string;
  description: string | null;
  points_required: number;
  icon: string | null;
  stock: number;
  affordable: boolean;
  already_requested: boolean;
}

export interface KidRewards {
  points_balance: number;
  rewards: KidReward[];
}

export interface PointTransaction {
  id: string;
  amount: number;
  type: TransactionType;
  description: string | null;
  created_at: string;
}

export interface KidHistory {
  transactions: PointTransaction[];
}

export interface ParentChild {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  points_balance: number;
  /** Whether a PIN has been set. */
  pin_set: boolean;
  /** Whether the child can actually sign in (PIN set AND auth identity linked). */
  can_sign_in: boolean;
  pending_review: number;
  approved_total: number;
}

export interface PendingApproval {
  id: string;
  status: TaskStatus;
  due_date: string;
  completed_at: string | null;
  proof_image_url: string | null;
  task_title: string;
  task_description: string | null;
  points_reward: number;
  require_proof_image: boolean;
  child_id: string;
  child_name: string;
}

export interface PendingRedemption {
  id: string;
  status: RedemptionStatus;
  points_spent: number;
  requested_at: string;
  reward_title: string;
  reward_description: string | null;
  reward_icon: string | null;
  child_id: string;
  child_name: string;
  child_balance: number;
}

/** A child's persistence score. Both counts are in days. */
export interface Streak {
  current: number;
  longest: number;
  today_complete: boolean;
}

/** One day in the completion series. Days with no work at all are absent. */
export interface DailyCompletion {
  day: string;
  assigned: number;
  approved: number;
  complete: boolean;
}

export interface ChildReportTotals {
  assigned: number;
  approved: number;
  submitted: number;
  rejected: number;
  points_earned: number;
}

export interface ChildReport {
  id: string;
  display_name: string;
  points_balance: number;
  streak: Streak;
  totals: ChildReportTotals;
  daily: DailyCompletion[];
}

export interface ParentReports {
  from: string;
  to: string;
  days: number;
  children: ChildReport[];
  family_totals: { assigned: number; approved: number };
}

/** A badge is derived from the data on every read, never stored. */
export interface Badge {
  code: string;
  title: string;
  icon: string;
  earned: boolean;
  progress: number;
  target: number;
}

export interface KidAchievements {
  child: {
    id: string;
    display_name: string;
    points_balance: number;
  };
  streak: Streak;
  approved_total: number;
  badges: Badge[];
  history: PointTransaction[];
  transaction_count: number;
}

export interface ParentReward {
  id: string;
  title: string;
  description: string | null;
  points_required: number;
  icon: string | null;
  stock: number;
  is_active: boolean;
}

export interface ParentTask {
  id: string;
  title: string;
  description: string | null;
  points_reward: number;
  recurrence: Recurrence;
  require_proof_image: boolean;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  category_id: string | null;
  created_at: string;
}

export interface ActivityEntry {
  id: string;
  amount: number;
  type: TransactionType;
  description: string | null;
  created_at: string;
  child_name: string | null;
}

export interface ParentOverview {
  family: { id: string; family_name: string };
  parent: { id: string; display_name: string; email: string | null };
  children: ParentChild[];
  pending_approvals: PendingApproval[];
  pending_redemptions: PendingRedemption[];
  rewards: ParentReward[];
  tasks: ParentTask[];
  recent_activity: ActivityEntry[];
  points_awarded_30d: number;
}

export interface ChildProfile {
  username: string;
  display_name: string;
  avatar_url: string | null;
}

/**
 * Error codes raised by the database functions. Mapping them to messages here
 * keeps user-facing copy out of the SQL layer and out of every call site.
 */
export const DB_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  PARENT_ROLE_REQUIRED: "Chỉ bố/mẹ mới thực hiện được thao tác này.",
  CHILD_ROLE_REQUIRED: "Thao tác này chỉ dành cho tài khoản của bé.",
  INSTANCE_NOT_SUBMITTABLE:
    "Việc này không thể nộp được nữa (có thể đã nộp hoặc đã được duyệt).",
  INSTANCE_NOT_AWAITING_APPROVAL:
    "Việc này không còn ở trạng thái chờ duyệt. Có thể đã được duyệt trước đó.",
  INSTANCE_NOT_AWAITING_REVIEW:
    "Việc này không còn ở trạng thái chờ duyệt.",
  REQUEST_NOT_PENDING: "Yêu cầu này đã được xử lý rồi.",
  REWARD_NOT_FOUND: "Không tìm thấy phần thưởng.",
  REWARD_OUT_OF_STOCK: "Phần thưởng này đã hết.",
  INSUFFICIENT_POINTS: "Bé chưa đủ điểm để đổi phần thưởng này.",
  ALREADY_REQUESTED: "Bé đã gửi yêu cầu đổi phần thưởng này rồi.",
  USERNAME_TAKEN: "Tên đăng nhập này đã có bé khác dùng.",
  USERNAME_REQUIRED: "Vui lòng nhập tên đăng nhập cho bé.",
  DISPLAY_NAME_REQUIRED: "Vui lòng nhập tên hiển thị.",
  TITLE_REQUIRED: "Vui lòng nhập tên.",
  FAMILY_NAME_REQUIRED: "Vui lòng nhập tên gia đình.",
  POINTS_MUST_BE_POSITIVE: "Số điểm phải lớn hơn 0.",
  AMOUNT_REQUIRED: "Vui lòng nhập số điểm cần điều chỉnh.",
  // `users.points_balance` carried CHECK (points_balance >= 0) until migration 0010
  // dropped it, because a penalty has to be recordable even when the child has nothing
  // left to lose. This entry can now only fire on a database that has not run that
  // migration yet; keeping it means such a deployment explains itself instead of falling
  // back to the generic "Có lỗi xảy ra. Vui lòng thử lại."
  users_points_balance_check:
    "Bé không đủ điểm để trừ như vậy. Số dư có thể vừa thay đổi — vui lòng xem lại số điểm của bé.",
  PIN_MUST_BE_4_TO_8_DIGITS: "Mã PIN phải gồm 4 đến 8 chữ số.",
  TOO_MANY_ATTEMPTS:
    "Bé đã nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.",
  CHILD_NOT_FOUND: "Không tìm thấy bé này trong gia đình.",
  TASK_NOT_FOUND: "Không tìm thấy việc này.",
  // One message for wrong, expired, used and revoked alike: the database deliberately
  // does not say which, because telling a stranger whether a code ever existed is
  // telling them something they should not know.
  INVITE_INVALID_OR_EXPIRED:
    "Mã mời không đúng, đã dùng rồi, hoặc đã hết hạn. Nhờ người mời tạo mã mới giúp bạn.",
  INVITE_NOT_REVOCABLE: "Mã mời này không thu hồi được nữa.",
  FAMILY_FULL: "Gia đình này đã đủ số người. Nhờ người trong gia đình kiểm tra lại.",
  TOO_MANY_ACTIVE_INVITES:
    "Đang có quá nhiều mã mời chưa dùng. Thu hồi bớt rồi tạo mã mới.",
  INVALID_AVATAR: "Ảnh đại diện này không hợp lệ. Vui lòng chọn lại từ danh sách.",
};

/** Turns a raw Supabase/Postgres error into a message safe to show a user. */
export function describeDbError(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : "";

  for (const [code, message] of Object.entries(DB_ERROR_MESSAGES)) {
    if (raw.includes(code)) return message;
  }
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

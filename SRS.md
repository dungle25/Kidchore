Dưới đây là tài liệu **Software Requirement Specification (SRS)** chi tiết dành cho dự án phát triển Web Application quản lý thói quen và giao việc cho trẻ em (tương tự NeatKid), được thiết kế theo chuẩn kỹ thuật để team Engineering (Dev/QA/Architect) có thể triển khai ngay.

---

## 1. Tổng quan hệ thống (System Overview)

* **Tên dự án (dự kiến):** KidChore Web Platform
* **Kiến trúc:** Progressive Web App (PWA) / Responsive Web App (tối ưu UI/UX riêng biệt cho Desktop và Mobile Browser).
* **Mô hình người dùng:** Multi-tenant theo hộ gia đình (`Family`).
* **Đối tượng sử dụng:**
* **Parent (Phụ huynh):** Quản lý gia đình, tạo nhiệm vụ, duyệt công việc, thiết lập kho thưởng, quản lý tài chính/điểm số.
* **Child (Trẻ em):** Nhận nhiệm vụ, đánh dấu hoàn thành (kèm ảnh bằng chứng), đổi thưởng, theo dõi tiến độ cá nhân.



---

## 2. Yêu cầu giao diện & UI/UX (Responsive Design)

### 2.1. Parent UI Strategy

* **Desktop Screen (Ưu tiên):** Thiết kế dạng Dashboard tổng quan. Chia bố cục nhiều cột (Sidebar navigation, Main Content, Summary Panel) giúp thao tác nhanh nhiều trẻ cùng lúc, duyệt ảnh bằng chứng dạng Grid/List, xem báo cáo biểu đồ trực quan.
* **Mobile Screen:** Cấu trúc danh sách cuộn dọc, Bottom Navigation bar cho các tác vụ nhanh (Duyệt việc nhanh 1-tap, Thêm nhanh nhiệm vụ).

### 2.2. Children UI Strategy

* **Thiết kế định hướng:** Visual-first, gamified UI (nhiều icon, màu sắc rực rỡ, card lớn, thanh tiến trình có hoạt họa).
* **Trải nghiệm thao tác:** Nút bấm to (Touch-friendly), chữ lớn, hạn chế nhập liệu văn bản. Phù hợp cho cả Tablet/iPad gia đình và Điện thoại.

---

## 3. Database Schema Design (Relational DB - PostgreSQL/MySQL)

```sql
-- 1. Bảng Gia đình (Tenancy)
CREATE TABLE families (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bảng Người dùng (Phụ huynh & Trẻ em)
CREATE TYPE user_role AS ENUM ('PARENT', 'CHILD');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    role user_role NOT NULL,
    display_name VARCHAR(50) NOT NULL,
    username VARCHAR(50) UNIQUE, -- Dùng cho trẻ em đăng nhập bằng PIN/Username
    email VARCHAR(100) UNIQUE,    -- Phụ huynh đăng nhập bằng Email/OAuth
    password_hash VARCHAR(255),
    pin_code VARCHAR(10),         -- PIN đăng nhập nhanh cho trẻ hoặc xác thực thao tác Parent
    avatar_url TEXT,
    points_balance INT DEFAULT 0 CHECK (points_balance >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Bảng Danh mục Nhiệm vụ / Phần thưởng
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    icon VARCHAR(50),
    color_code VARCHAR(10)
);

-- 4. Bảng Định nghĩa Nhiệm vụ (Task Master/Template)
CREATE TYPE recurrence_type AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'ONE_TIME');

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    title VARCHAR(150) NOT NULL,
    description TEXT,
    points_reward INT NOT NULL CHECK (points_reward > 0),
    require_proof_image BOOLEAN DEFAULT FALSE,
    recurrence recurrence_type DEFAULT 'DAILY',
    assigned_to_user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL nghĩa là assign cho tất cả trẻ
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Bảng Bảng ghi Nhiệm vụ theo Ngày (Task Instances)
CREATE TYPE task_status AS ENUM ('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED');

CREATE TABLE task_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    assigned_child_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    due_date DATE NOT NULL,
    status task_status DEFAULT 'PENDING',
    proof_image_url TEXT,
    rejection_reason TEXT,
    completed_at TIMESTAMP WITH TIME ZONE,
    approved_at TIMESTAMP WITH TIME ZONE,
    approved_by_user_id UUID REFERENCES users(id)
);

-- 6. Bảng Kho Phần thưởng
CREATE TABLE rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    description TEXT,
    points_required INT NOT NULL CHECK (points_required > 0),
    icon VARCHAR(50),
    stock INT DEFAULT -1, -- -1 là vô hạn
    is_active BOOLEAN DEFAULT TRUE
);

-- 7. Bảng Yêu cầu Đổi thưởng
CREATE TYPE redemption_status AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');

CREATE TABLE redemption_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reward_id UUID NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
    child_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    points_spent INT NOT NULL,
    status redemption_status DEFAULT 'REQUESTED',
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    processed_by_user_id UUID REFERENCES users(id)
);

-- 8. Bảng Lịch sử Giao dịch Điểm (Audit Log)
CREATE TYPE transaction_type AS ENUM ('TASK_COMPLETED', 'REWARD_REDEEMED', 'MANUAL_ADJUSTMENT');

CREATE TABLE point_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INT NOT NULL, -- Số dương (+) hoặc âm (-)
    type transaction_type NOT NULL,
    reference_id UUID,   -- ID của task_instance hoặc redemption_request
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

```

---

## 4. Chi tiết Chức năng Trang Parent (Parent Portal Pages)

### 4.1. Parent Dashboard (`/parent/dashboard`)

* **Chức năng chính:**
* Xem nhanh danh sách công việc trẻ vừa nộp cần duyệt (*Approval Queue*).
* Widget hiển thị điểm số, tiến độ hoàn thành việc trong ngày của từng đứa trẻ.
* Lịch biểu tổng quan công việc gia đình trong ngày/tuần.


* **Tác vụ chính:** 1-Click Approve / Reject (kèm ghi chú lý do rejection).

### 4.2. Task Management (`/parent/tasks`)

* **Chức năng chính:**
* Quản lý CRUD danh sách nhiệm vụ (Tên, mô tả, số điểm, lịch lặp lại, gán cho bé nào).
* Bật/tắt yêu cầu chụp ảnh xác nhận (`require_proof_image`).
* Gom nhóm nhiệm vụ theo Category (Nhà cửa, Học tập, Thể thao, Thói quen cá nhân).



### 4.3. Reward Store Management (`/parent/rewards`)

* **Chức năng chính:**
* Tạo/sửa/xóa các phần thưởng (đồ chơi, xem TV 30 phút, đi công viên,...).
* Thiết lập mức điểm tương ứng và số lượng khả dụng (stock).
* Duyệt các yêu cầu đổi thưởng từ trẻ em (*Redemption Requests*).



### 4.4. Family & Kid Profiles (`/parent/family`)

* **Chức năng chính:**
* Tạo tài khoản phụ cho trẻ (Username/PIN).
* Đặt lại mã PIN, cộng/trừ điểm thủ công (Manual Point Adjustment).
* Phân quyền cho thành viên khác trong gia đình (Sử dụng chung tài khoản Parent).



### 4.5. Analytics & Reports (`/parent/reports`)

* **Chức năng chính:**
* Biểu đồ tỷ lệ hoàn thành nhiệm vụ theo thời gian (Tuần/Tháng).
* Báo cáo sự kiên trì (Streak score) của trẻ đối với từng thói quen cụ thể.



---

## 5. Chi tiết Chức năng Trang Children (Children Portal Pages)

### 5.1. Kids Home / Daily Tasks (`/kid/dashboard`)

* **Chức năng chính:**
* Hiển thị danh sách công việc phải làm hôm nay (`due_date = TODAY`).
* Trạng thái nhiệm vụ trực quan: *Chưa làm (Pending)*, *Đang chờ duyệt (Submitted)*, *Đã xong (Approved)*.
* Tích hợp Web Cam / Upload file để chụp ảnh bằng chứng trực tiếp trên trình duyệt mobile/desktop.



### 5.2. Reward Shop (`/kid/rewards`)

* **Chức năng chính:**
* Hiển thị quỹ điểm hiện tại (`points_balance`) dạng hình ảnh hũ tiền/ngôi sao.
* Danh sách phần thưởng có thể đổi. Tự động Disable các món chưa đủ điểm.
* Nút "Đổi quà" (Redeem) gửi yêu cầu trực tiếp về trang Parent.



### 5.3. Achievement & History (`/kid/achievements`)

* **Chức năng chính:**
* Xem lịch sử nhận điểm và lịch sử đổi quà.
* Bảng vinh danh badge/huy hiệu đạt được khi hoàn thành các chuỗi thói quen (Streak 7 ngày, 30 ngày).



---

## 6. Yêu cầu Phi chức năng & Kỹ thuật (Non-Functional Requirements)

1. **Authentication & Authorization:**
* JWT-based auth với Role-based Access Control (RBAC).
* Phụ huynh switch sang view Trẻ em không cần logout, nhưng quay lại Parent view phải nhập **Parent PIN code** (4-6 chữ số).


2. **Web Capabilities (PWA & Media Handling):**
* Hỗ trợ PWA Manifest để trẻ/bố mẹ cài đặt ứng dụng vào Home Screen thiết bị mobile.
* Tích hợp HTML5 Camera API để chụp ảnh bằng chứng trực tiếp không qua ứng dụng bên thứ ba.
* Tối ưu nén ảnh phía Client (Image compression) trước khi upload lên Cloud Storage (S3/Cloudinary) để tiết kiệm băng thông.


3. **Real-time Notifications:**
* Tích hợp Web Push Notifications hoặc WebSocket/Server-Sent Events (SSE) để báo cho Parent ngay khi Child nộp bài, hoặc báo cho Child khi Parent đã duyệt/cho quà.
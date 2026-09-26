# KidChore — Design System

Ngôn ngữ thiết kế của app, viết ra để một công cụ thiết kế (hoặc một người mới) dựng được
màn hình **khớp với những màn hình đã có**, thay vì đoán.

Số liệu dưới đây lấy từ chính code: đếm tần suất class Tailwind trong `app/` và
`components/`, đọc `app/globals.css`, và các layout của hai khu vực.

---

## 1. Nguyên tắc

**Hai khu vực, hai người dùng khác nhau, hai cách bố trí.** Đây là quyết định lớn nhất và
mọi thứ khác đi theo nó.

| | Khu bố/mẹ | Khu của bé |
|---|---|---|
| Thiết bị | Laptop, ngồi ở bàn | Máy tính bảng, cầm trên tay |
| Điều hướng | Sidebar bên trái | Thanh cố định ở **đáy** màn hình |
| Mật độ | Dày, `text-sm`, nhiều mục mỗi màn | Thoáng, chữ to, ít mục |
| Thẻ | `rounded-xl` viền mảnh | `rounded-2xl`, viền dày 2px |
| Nền | `slate-100` phẳng | Gradient `violet-50 → slate-50` |
| Biểu tượng | Không, chỉ chữ | Emoji (🏠 📋 🎁 🏆) |

**Chỉ chế độ sáng.** Cố ý không theo dark mode của hệ điều hành. Lý do ghi trong
`app/globals.css`: trẻ dùng trên máy tính bảng dùng chung, một giao diện tối bất ngờ làm
các thẻ sáng khó nhận ra; còn màn hình duyệt ảnh của bố/mẹ cần nền trắng ổn định.

**Trạng thái luôn nói ra bằng màu VÀ bằng chữ.** Không có chỉ dấu nào chỉ dựa vào màu.

---

## 2. Màu

Đơn vị: tên Tailwind, kèm mã hex cho màu chủ đạo.

### Chủ đạo

| Vai trò | Class | Hex |
|---|---|---|
| Nút chính, liên kết, viền focus | `violet-600` | `#7c3aed` |
| Nút chính khi hover | `violet-700` | `#6d28d9` |
| Nền nhấn nhẹ, thẻ gợi ý | `violet-50` | `#f5f3ff` |
| Viền nhấn | `violet-200` / `violet-300` | `#ddd6fe` / `#c4b5fd` |
| Chữ trên nền nhấn | `violet-900` | `#4c1d95` |

### Chữ

| Vai trò | Class |
|---|---|
| Tiêu đề | `slate-800` |
| Nhãn, chữ chính | `slate-700` |
| Nội dung, mô tả | `slate-500` |
| Phụ chú, metadata | `slate-400` |

### Nền và viền

| Vai trò | Class |
|---|---|
| Nền khu bố/mẹ | `slate-100` |
| Nền trang, thẻ phụ | `slate-50` |
| Thẻ | `white` |
| Viền thẻ | `slate-200` |
| Viền ô nhập | `slate-300` |

### Trạng thái

| Ý nghĩa | Màu | Dùng ở đâu |
|---|---|---|
| Xong, được duyệt | `green-200/600/800`, nền `green-50/100` | Viền thẻ đã duyệt, nhãn "Đã xong" |
| Chờ xử lý | `amber-100/800` | Badge điểm, "Chờ bố/mẹ duyệt" |
| Bị trả lại | `amber-300`, nền `amber-50` | Thẻ việc bị trả lại kèm lý do |
| Đang gửi | `blue-200/600` | Thẻ vừa nộp |
| Lỗi | `red-200/700`, nền `red-50` | Thông báo lỗi |
| **Điểm nợ** | `rose-500 → red-600` (gradient) | Thẻ điểm khi số dư âm |
| Điểm dương | `green-500 → emerald-600` (gradient) | Thẻ điểm khi số dư ≥ 0 |

Điểm nợ là một trạng thái riêng, không phải "điểm thấp": thẻ đổi hẳn sang đỏ và câu chữ
đổi thành "Con đang nợ N điểm".

---

## 3. Chữ

- **Font**: Geist Sans (`next/font/google`, tự host). Fallback `Arial, Helvetica, sans-serif`.
- **Font mono**: Geist Mono, chỉ dùng cho nội dung kỹ thuật.

| Vai trò | Class | Ghi chú |
|---|---|---|
| Nội dung mặc định | `text-sm` | Dùng nhiều nhất, 142 lần |
| Phụ chú, metadata | `text-xs` | 83 lần |
| Tiêu đề mục | `text-lg` / `text-xl` | |
| Tiêu đề trang (bố/mẹ) | `text-2xl font-bold` | |
| Tiêu đề trang (bé) | `text-3xl font-extrabold` | To hơn hẳn khu bố/mẹ |
| Số liệu lớn (điểm) | `text-4xl font-extrabold` | |
| Nhãn nhỏ in hoa | `text-xs font-semibold uppercase tracking-wide text-slate-400` | |

Cân nặng: `font-medium` (68) → `font-semibold` (50) → `font-bold` (41) → `font-extrabold` (14).
Khu của bé nghiêng hẳn về `font-bold`/`font-extrabold`; khu bố/mẹ dùng `font-medium`.

---

## 4. Hình khối và khoảng cách

| Vai trò | Class | Số lần |
|---|---|---|
| Ô nhập, nút nhỏ | `rounded-lg` | 99 |
| Thẻ | `rounded-xl` | 32 |
| Thẻ lớn khu bé | `rounded-2xl` | 20 |
| Avatar, badge | `rounded-full` | 13 |

- **Bóng**: `shadow-sm` cho thẻ, `shadow` cho thẻ nổi (thẻ điểm của bé).
- **Viền thẻ khu bé**: `border-2` — dày gấp đôi khu bố/mẹ, để nhìn rõ trên máy tính bảng.
- **Vùng chạm**: nút chính của bé `px-6 py-3 text-base`, tối thiểu 44px chiều cao.
- **Bo góc trong cùng một thẻ**: ngoài `rounded-2xl`, các phần tử con dùng `rounded-xl` hoặc
  `rounded-lg`, giảm dần theo cấp.
- **Nút**: `px-4 py-2.5` (thường), `px-6 py-3` (nút hành động chính của bé),
  `disabled:opacity-60`.
- **Focus**: `outline: 2px solid #7c3aed; outline-offset: 2px` — khai báo một lần trong
  `globals.css` cho `:focus-visible`, không tắt ở bất kỳ đâu.

---

## 5. Thành phần

### Thẻ
Nền trắng, viền `slate-200`, `rounded-xl`, `shadow-sm`, đệm `p-4`. Trong khu của bé:
`rounded-2xl`, viền `border-2`, đệm `p-4`, và màu viền thể hiện trạng thái.

### Thẻ số liệu (bố/mẹ)
Lưới `sm:grid-cols-3` (hoặc 4 ở trang tổng quan). Nhãn in hoa nhỏ phía trên, số lớn ở giữa,
chú thích nhỏ phía dưới. Một thẻ có thể là gradient (thẻ điểm của bé).

### Badge điểm
`rounded-full bg-amber-100 px-3 py-1.5 text-sm font-bold text-amber-800`, nội dung `+N`.
Luôn nằm góc phải trên của thẻ việc.

### Nút
- Chính: nền `violet-600`, chữ trắng, `font-semibold`, `rounded-lg` (khu bố/mẹ) hoặc
  `rounded-xl` (khu bé), hover `violet-700`.
- Phụ: nền trắng, viền `slate-300`, chữ `slate-700`, hover `slate-50`.
- Nguy hiểm: viền `red-300`, chữ `red-700`, hover nền `red-50`.
- Thưởng nhanh: nền `green-50`, viền `green-300`, chữ `green-800`.
- Phạt nhanh: nền `rose-50`, viền `rose-300`, chữ `rose-800`, dùng dấu trừ U+2212 (−) chứ
  không phải gạch nối.

### Ô nhập
Viền `slate-300`, `rounded-lg`, `px-3 py-2`, focus đổi viền sang `violet-500` và bỏ outline
mặc định. Ô nhập PIN: `text-center text-xl tracking-[0.4em]`.

### Trạng thái rỗng
Viền đứt `border-2 border-dashed border-violet-200`, nền trắng, một emoji lớn, tiêu đề
`font-bold`, và một câu giải thích phải làm gì tiếp.

### Điều hướng
- Bố/mẹ: sidebar trái, mục đang mở có nền `violet-100` và chữ `violet-900`.
- Bé: thanh đáy cố định, mỗi mục là emoji `text-2xl` trên nhãn `text-xs font-bold`. Mục
  đang mở có chữ `violet-700`, còn lại `slate-400`. Phía trên thanh có dải
  "Đang dùng: {tên}" để biết đang ở hồ sơ của ai.

---

## 6. Giọng nói và ngôn ngữ

- **Toàn bộ chữ hiển thị bằng tiếng Việt.**
- **Xưng hô theo vai trò.** Khu của bé gọi người dùng là "con" và bố/mẹ là "bố/mẹ"
  ("Hôm nay con còn 3 việc"). Khu bố/mẹ gọi bé là "bé" và người dùng là "bạn".
- **Nói hậu quả trước, không chỉ chặn.** Ví dụ khi bé sắp bị trừ quá số dư, thẻ hiện
  "Bé chỉ còn 2 điểm — phạt quá 2 điểm sẽ thành điểm nợ (âm điểm)" thay vì chỉ khoá nút.
- **Câu ngắn, động từ rõ.** "Đã làm xong 🚀", "Làm lại & gửi", "Vào".
- **Emoji có chức năng**, không phải trang trí: chúng là biểu tượng điều hướng và dấu trạng
  thái ở khu của bé, và không xuất hiện trong nhãn nút của bố/mẹ.

---

## 7. Điều **không** được làm khi vẽ thêm màn hình

- Không dùng dark mode, không thêm biến thể tối.
- Không dùng màu ngoài bảng trên; đặc biệt không thêm màu chủ đạo thứ hai.
- Không đổi `violet-600` thành màu khác cho nút chính.
- Không làm mục điều hướng của bé thành chữ nhỏ hay bỏ emoji — đó là điểm chạm chính.
- Không biểu diễn trạng thái chỉ bằng màu mà thiếu chữ.
- Không đặt nút hành động chính của bé cao dưới 44px.

# Bộ kiểm thử giao diện (UI regression suite)

Tài liệu này mô tả bộ test giao diện: nó kiểm cái gì, chạy thế nào, và khi nào phải chạy.
Mã nguồn là `scripts/test-ui.mjs`.

## 1. Vì sao cần một bộ riêng

`scripts/test-e2e.mjs` đã kiểm rất kỹ phần **server**: route nào bị chặn, cookie nào được
cấp, trang có render đúng dữ liệu của gia đình hay không. Nhưng nó chỉ đọc HTML trả về, nên
nó **không nhìn thấy** đúng những thứ mà một lần sửa giao diện hay làm hỏng:

- bố cục vỡ, thanh điều hướng không còn nằm ở đáy màn hình;
- nút bấm không phản hồi, hoặc một client component lỗi khi hydrate;
- tab đang mở không còn được đánh dấu `aria-current`;
- vùng bấm nhỏ đi đến mức trẻ con không bấm trúng;
- một lỗi console chỉ xuất hiện khi có JavaScript chạy.

Những lỗi đó **không đổi HTML** mà `test:e2e` đọc, nên nó vẫn xanh. Đó là lý do bộ này tồn
tại, và là lý do nó chạy bằng trình duyệt thật thay vì bằng `fetch`.

## 2. Bộ test kiểm gì

| Nhóm | Nội dung được kiểm |
| --- | --- |
| Màn hình đăng nhập | Người lạ vào `/` bị đưa về `/login`; hai khu vực cho bố/mẹ và cho bé; nút Google; danh sách bé; **PIN sai thì hiện lỗi trên màn hình** |
| Đăng nhập của bé | Điền PIN thật rồi bấm "Vào" → vào đúng `/kid/dashboard` (đăng nhập qua giao diện, không mint cookie sẵn) |
| Thao tác của bé | Bấm "Đã làm xong" → có thông báo, thẻ chuyển sang "Chờ bố/mẹ duyệt", số đếm ở nhóm giảm; việc **cần ảnh** thì từ chối gửi khi chưa có ảnh; tải lại trang thì trạng thái vẫn còn (chứng minh đã ghi xuống server) |
| Điều hướng | Bấm từng mục thì mở đúng màn hình, và mục đang mở có `aria-current="page"` |
| Bố cục của bé | Thanh điều hướng dính đúng đáy khung nhìn, trải hết chiều ngang, vùng bấm ≥ 44px, không cuộn ngang trên màn hình điện thoại |
| Màn hình của bố/mẹ | Sidebar hiện và thanh dưới ẩn ở khổ desktop; tên gia đình; đủ 6 mục điều hướng; hàng đợi duyệt gom theo bé; ảnh bằng chứng; danh mục thêm nhanh; bộ chọn ảnh đại diện; trang báo cáo |
| Bố cục của bố/mẹ | Ở khổ điện thoại thì sidebar nhường chỗ cho thanh dưới, thanh dưới dính đáy |
| Đăng xuất | Bấm "Thoát" → về `/login`, và khu của bé thực sự đóng lại |
| Lỗi trình duyệt | Mỗi màn hình đều bị bắt mọi `pageerror` và lỗi console; có lỗi là fail |

Ngoài ra mỗi màn hình đều được tải thật, nên một trang trả 500 cũng bị bắt.

## 3. Cách chạy

```bash
npm run test:ui                    # cần app đang chạy sẵn
npm run test:ui -- --start-server  # tự build rồi tự chạy app
npm run test:ui -- --reuse-build   # dùng bản build có sẵn trong .next
```

Trong `npm run test:all`, bộ này chạy **cuối cùng**, sau `test:e2e`, và truyền
`--reuse-build` vì bộ HTTP vừa build xong trong cùng lượt chạy — build lại lần nữa chỉ tốn
thêm vài phút mà không kiểm thêm được gì.

Bộ test tự tạo một gia đình tạm (`__UI_FAMILY__`) cùng bé, việc và phần thưởng, rồi tự xoá
trong `finally` — kể cả khi test fail giữa đường. Nó không đọc và không sửa dữ liệu thật.

### Trình duyệt

Bộ test chạy bằng `playwright-core`, thư viện **không kèm trình duyệt**. Thứ tự tìm:

1. Microsoft Edge có sẵn trên máy (`msedge`);
2. Google Chrome có sẵn trên máy (`chrome`);
3. Chromium do Playwright tải về (`npx playwright-core install chromium`).

Máy dev thường đã có Edge hoặc Chrome nên không phải tải gì. CI không chắc có trình duyệt
nào, nên workflow cài Chromium trước khi chạy (`Install the browser for the UI suite`).

Lệnh là `playwright-core`, **không** phải `playwright`: repo chỉ cài `playwright-core`, và
`npx playwright ...` sẽ tải thêm một bản `playwright` thứ hai — có thể lệch phiên bản với thư
viện đang dùng. Trình duyệt tải về phải khớp revision mà `playwright-core` đang chờ.

Nếu không tìm được trình duyệt nào, bộ test **fail** chứ không bỏ qua: một bộ test giao diện
im lặng không chạy còn tệ hơn không có, vì nó báo xanh cho một thứ chưa hề được kiểm.

## 4. Khi nào phải chạy

- Mỗi lần sửa giao diện, trước khi mở PR: `npm run test:ui`.
- Tự động: CI chạy trong `npm run test:all` (job `integration`). Job này chỉ chạy khi đã cấu
  hình secrets của database — xem `.github/workflows/ci.yml`.

## 5. Quy ước khi thêm một kiểm tra mới

- **Neo vào thứ người dùng thấy**, không neo vào class CSS: heading theo tên, link theo nhãn,
  `aria-current` cho tab đang mở, `data-group` / `data-child-heading` cho các nhóm mà app đã
  chủ động đánh dấu trong DOM. Đổi màu hay đổi bo góc không được làm test đỏ; đổi chữ thì phải.
- **Sau mỗi lần điều hướng thì chờ** trước khi hỏi: `appears()` và `settle()` có sẵn trong
  file. Hỏi ngay sau `waitForURL` sẽ hỏi nhầm màn hình cũ, vì URL đổi trước khi DOM đổi —
  đây là nguyên nhân của mọi lần fail giả khi bộ test này được viết.
- **Regex làm tên accessible phải khớp toàn bộ chuỗi**: `/Chào Bé/` không khớp
  `"Chào Bé! 👋"`, còn chuỗi thường `"Chào Bé"` thì khớp (so chuỗi con, không phân biệt hoa
  thường). Dùng chuỗi thường khi chỉ muốn khớp một phần.
- **Lỗi console là fail.** Nếu có ngoại lệ chính đáng thì thêm vào `IGNORED_CONSOLE` kèm lý
  do cụ thể, như trường hợp ảnh bằng chứng trỏ vào object không tồn tại trong Storage.
- **Một `check()` chỉ nên khẳng định một điều**, và phần `detail` phải in ra giá trị thật để
  đọc log là biết ngay sai ở đâu.
- **Mọi fixture phải được xoá trong `finally`**, và không được đụng vào dữ liệu thật.

## 6. Ghi chú vận hành

- Bộ test cần `.env.local` (đọc `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_JWT_SECRET`) vì nó tạo fixture trong database thật và mint session token đúng
  cách app làm.
- Token của `gh`/API GitHub không bao giờ nằm trong file được commit: `scripts/gh-*.mjs`
  đọc nó từ `.env.local` (đã bị `.gitignore` loại), còn `gh` CLI đọc từ cấu hình người dùng
  (`%APPDATA%\GitHub CLI\hosts.yml`). Cả hai đều **không** được đưa vào issue, PR hay tài liệu.

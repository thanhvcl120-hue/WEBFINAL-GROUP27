import React, { useRef, useState } from "react";
import { Plus, Search, Trash2, UtensilsCrossed, X } from "lucide-react";
import { callApi, money, useLiveUpdates, useResource } from "./staff-api.js";
import { RequireStaff } from "./StaffLogin.jsx";
import { ErrorNotice, PageHeading, StaffDialog } from "./StaffUI.jsx";
import { plain } from "./staff-model.js";
import "./staff.css";

const BLANK = { name: "", category: "", description: "", price: "", image: "", popular: false };

function DishPhoto({ src, name }) {
  const [failed, setFailed] = useState(false);
  return <div className="dish-photo">{src && !failed ? <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)}/> : <UtensilsCrossed size={22} aria-label="Chưa có ảnh"/>}</div>;
}

function DishForm({ dish, categories, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => ({ ...BLANK, ...dish, price: dish?.price ?? "" }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const set = (field, value) => setDraft(current => ({ ...current, [field]: value }));
  const save = async event => {
    event.preventDefault();
    if (lock.current) return;
    if (!draft.name.trim() || !draft.category.trim()) { setError("Vui lòng nhập tên món và danh mục."); return; }
    lock.current = true; setBusy(true); setError("");
    try {
      const body = JSON.stringify({ name: draft.name.trim(), category: draft.category.trim(), description: draft.description.trim(), image: draft.image.trim(), price: Number(draft.price), popular: !!draft.popular });
      const saved = dish ? await callApi("/menu/" + dish.id, { method: "PATCH", body }) : await callApi("/menu", { method: "POST", body });
      onSaved(saved);
    } catch (problem) { setError(problem.message); }
    finally { lock.current = false; setBusy(false); }
  };
  return <StaffDialog title={dish ? "Chỉnh sửa món" : "Thêm món mới"} onClose={onClose} busy={busy}>
    <form className="dish-form" onSubmit={save}>
      <p className="staff-hint">Tên món, danh mục và giá là thông tin bắt buộc.</p>
      <fieldset disabled={busy}>
        <label>Tên món<input autoFocus value={draft.name} onChange={event => set("name", event.target.value)} required maxLength={120}/></label>
        <div className="dish-form-grid"><label>Danh mục<input value={draft.category} onChange={event => set("category", event.target.value)} required list="dish-categories" maxLength={80}/><datalist id="dish-categories">{categories.map(name => <option key={name} value={name}/>)}</datalist></label>
          <label>Giá (đồng)<input type="number" min="1" max="100000000" step="1" value={draft.price} onChange={event => set("price", event.target.value)} required/></label></div>
        <label>Mô tả<textarea rows={3} value={draft.description} onChange={event => set("description", event.target.value)} maxLength={300}/></label>
        <label>Đường dẫn ảnh<input value={draft.image} maxLength={500} onChange={event => set("image", event.target.value)} placeholder="https://… hoặc /images/pho.jpg"/></label>
        <span className="staff-hint">Để trống nếu chưa có ảnh. Chỉ dùng ảnh bạn có quyền sử dụng.</span>
        <label className="dish-check"><input type="checkbox" checked={!!draft.popular} onChange={event => set("popular", event.target.checked)}/> Món được yêu thích</label>
      </fieldset>
      <ErrorNotice error={error}/>
      <div className="dish-actions"><button type="button" className="ghost" disabled={busy} onClick={onClose}>Hủy</button><button type="submit" className="solid" disabled={busy}>{busy ? "Đang lưu…" : "Lưu món"}</button></div>
    </form>
  </StaffDialog>;
}

function MenuBoard({ staff }) {
  const { data: menu, setData: setMenu, loading, error: loadError, load } = useResource("/menu", []);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const lock = useRef(false);
  const connection = useLiveUpdates(["menu-updated"], load);
  const isManager = staff.role === "manager";
  const mutate = async (dish, remove = false) => {
    if (lock.current) return;
    lock.current = true; setPendingId(dish.id); setError("");
    try {
      const saved = await callApi("/menu/" + dish.id, remove ? { method: "DELETE" } : { method: "PATCH", body: JSON.stringify({ available: !dish.available }) });
      setMenu(items => remove ? items.filter(item => item.id !== dish.id) : items.map(item => item.id === saved.id ? saved : item));
      if (remove) setDeleting(null);
      load();
    } catch (problem) { setError(problem.message); }
    finally { lock.current = false; setPendingId(null); }
  };
  const query = plain(search.trim());
  const categories = [...new Set(menu.map(item => item.category))];
  const activeCategory = categories.includes(category) ? category : "";
  const visible = menu.filter(item => (plain(item.name).includes(query) || plain(item.category).includes(query)) && (!activeCategory || item.category === activeCategory) && (filter === "all" || (filter === "available") === item.available));
  const soldOut = menu.filter(item => !item.available).length;
  return <main className="staff-main">
    <PageHeading eyebrow="THỰC ĐƠN TẠI QUÁN" title="Quản lý thực đơn" description="Cập nhật món ăn, để khách luôn chọn đúng món còn phục vụ." connection={connection}/>
    <div className="staff-stats"><div><span>Tổng số món</span><strong>{loading ? "—" : menu.length}</strong></div><div><span>Đang hết món</span><strong>{loading ? "—" : soldOut}</strong></div></div>
    <div className="menu-toolbar"><label className="staff-search"><Search size={18}/><input value={search} onChange={event => setSearch(event.target.value)} aria-label="Tìm món hoặc danh mục" placeholder="Tìm món hoặc danh mục…"/>{search && <button onClick={() => setSearch("")} aria-label="Xóa tìm kiếm"><X size={18}/></button>}</label>
      {isManager && <button className="solid" onClick={() => setEditing(BLANK)}><Plus size={18}/> Thêm món</button>}
    </div>
    <div className="staff-filters"><select aria-label="Lọc danh mục" value={activeCategory} onChange={event => setCategory(event.target.value)}><option value="">Tất cả danh mục</option>{categories.map(name => <option key={name}>{name}</option>)}</select>
      <select aria-label="Lọc trạng thái món" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Tất cả trạng thái</option><option value="available">Còn món</option><option value="soldout">Hết món</option></select><span>{visible.length} món</span></div>
    {!isManager && <p className="staff-hint">Bếp có thể bật/tắt món. Quản lý phụ trách tên, giá và hình ảnh.</p>}
    <ErrorNotice error={loadError} retry={load}/>{!deleting && <ErrorNotice error={error}/>}
    {loading ? <div className="staff-empty" role="status">Đang tải thực đơn…</div> : !loadError || menu.length > 0 ? <ul className="dish-list">{visible.map(dish => <li key={dish.id} className={!dish.available ? "off" : ""}>
      <DishPhoto key={dish.id + ":" + dish.image} src={dish.image} name={dish.name}/><div className="dish-info"><small>{dish.category}</small><h3>{dish.name}</h3><strong>{money(dish.price)}</strong>{dish.popular && <span className="dish-popular">Được yêu thích</span>}</div>
      <div className="dish-controls"><button className={"switch " + (dish.available ? "on" : "")} role="switch" aria-checked={dish.available} disabled={pendingId !== null} onClick={() => mutate(dish)} aria-label={"Còn món: " + dish.name}><i/><span>{pendingId === dish.id ? "Đang lưu…" : dish.available ? "Còn món" : "Hết món"}</span></button>
        {isManager && <><button className="icon" disabled={pendingId !== null} onClick={() => setEditing(dish)} aria-label={"Sửa " + dish.name}>Sửa</button><button className="icon danger" disabled={pendingId !== null} onClick={() => { setError(""); setDeleting(dish); }} aria-label={"Xóa " + dish.name}><Trash2 size={17}/></button></>}
      </div>
    </li>)}{visible.length === 0 && <li className="dish-empty"><h2>{menu.length ? "Không tìm thấy món phù hợp" : "Thực đơn chưa có món"}</h2><p>{menu.length ? "Thử từ khóa hoặc bộ lọc khác." : "Thêm món đầu tiên để bắt đầu phục vụ."}</p>{menu.length > 0 && <button className="ghost" onClick={() => { setSearch(""); setCategory(""); setFilter("all"); }}>Xóa bộ lọc</button>}</li>}</ul> : null}
    {editing && <DishForm dish={editing.id ? editing : null} categories={categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setError(""); load(); }}/>}
    {deleting && <StaffDialog title="Xóa món khỏi thực đơn?" onClose={() => setDeleting(null)} busy={pendingId !== null}><p className="dialog-copy">“{deleting.name}” sẽ không còn trên thực đơn. Các đơn đã gọi vẫn giữ thông tin cũ. Nếu chỉ tạm hết, bạn có thể chọn “Hết món”.</p><ErrorNotice error={error}/><div className="dish-actions"><button className="ghost" disabled={pendingId !== null} onClick={() => setDeleting(null)}>Giữ lại</button><button className="solid danger" disabled={pendingId !== null} onClick={() => mutate(deleting, true)}>{pendingId !== null ? "Đang xóa…" : "Xóa món"}</button></div></StaffDialog>}
  </main>;
}

export default function MenuAdmin() {
  return <RequireStaff roles={["kitchen", "manager"]}>{staff => <MenuBoard staff={staff}/>}</RequireStaff>;
}

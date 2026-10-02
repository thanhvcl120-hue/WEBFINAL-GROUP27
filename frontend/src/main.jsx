import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, ChefHat, ChevronDown, Clock3, Minus, Plus, Search, ShoppingBag, UtensilsCrossed, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import "./styles.css";
import { parseDemoTable } from "./demo-table.js";
import { summarizeOrders } from "./order-summary.js";
import { RequireStaff } from "./staff/StaffLogin.jsx";
import Cashier from "./staff/Cashier.jsx";
import MenuAdmin from "./staff/MenuAdmin.jsx";

const API = "/api";
const AppContext = createContext(null);
const STATUS_LABELS = { pending: "Chờ xác nhận", preparing: "Đang chế biến", ready: "Chờ phục vụ", completed: "Đã phục vụ", cancelled: "Đã hủy" };
const errorText = error => error instanceof TypeError ? "Không thể kết nối. Vui lòng thử lại." : error.message;
// Parse JSON safely: when the backend is down the proxy returns a non-JSON body.
const readJson = async res => { const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || "Không thể kết nối. Vui lòng thử lại."); return data; };
// Shown when a remote food photo fails to load.
const FALLBACK_IMG = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#ece8dc"/><text x="200" y="165" font-size="64" text-anchor="middle">🍜</text></svg>');
const onImgError = event => { if (event.currentTarget.src !== FALLBACK_IMG) event.currentTarget.src = FALLBACK_IMG; };
const money = value => `${Math.round(value).toLocaleString("vi-VN")}đ`; // 45000 -> "45.000đ"

function AppProvider({ children }) {
  const [cart, setCart] = useState(() => JSON.parse(sessionStorage.getItem("cart") || "[]"));
  const [table, setTable] = useState(() => Number(localStorage.getItem("table")) || null);
  const tableRef = useRef(table); tableRef.current = table;
  // Order history lives in localStorage so it survives closing the tab (same phone = same history).
  const [myOrders, setMyOrders] = useState(() => { try { const saved = JSON.parse(localStorage.getItem("myOrders") || "[]"); return Array.isArray(saved) ? saved.filter(Number.isInteger) : []; } catch { return []; } });
  useEffect(() => { try { localStorage.setItem("myOrders", JSON.stringify(myOrders)); } catch { /* storage unavailable: history lasts for this visit only */ } }, [myOrders]);
  const rememberOrder = id => setMyOrders(ids => [id, ...ids.filter(existing => existing !== id)].slice(0, 50));
  // Once the cashier settles a table, drop that seating's orders from this device
  // so the next guests start with an empty bill.
  const forgetPaidOrders = fetched => {
    const settled = fetched.filter(order => order.sessionStatus === "closed");
    const paid = new Set(settled.map(order => order.id));
    if (paid.size) setMyOrders(ids => ids.filter(id => !paid.has(id)));
    // Forget the table too, so this device cannot keep ordering onto whoever
    // sits there next; scanning the QR code again picks the table back up.
    // tableRef, not table: this runs from callbacks created on an earlier render.
    const seated = tableRef.current;
    const stillOpen = fetched.some(order => order.sessionStatus === "open" && order.tableNumber === seated);
    if (!stillOpen && settled.some(order => order.tableNumber === seated)) clearTable();
  };
  useEffect(() => sessionStorage.setItem("cart", JSON.stringify(cart)), [cart]);
  const add = item => setCart(items => {
    const found = items.find(entry => entry.id === item.id);
    return found ? items.map(entry => entry.id === item.id ? { ...entry, quantity: entry.quantity + 1 } : entry) : [...items, { ...item, quantity: 1, note: "" }];
  });
  const change = (id, quantity) => setCart(items => quantity < 1 ? items.filter(item => item.id !== id) : items.map(item => item.id === id ? { ...item, quantity } : item));
  const clearTable = () => { setTable(null); localStorage.removeItem("table"); };
  const value = { cart, setCart, table, setTable: value => { setTable(value); localStorage.setItem("table", value); }, clearTable, add, change, myOrders, setMyOrders, rememberOrder, forgetPaidOrders };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function Brand() { return <Link className="brand" to="/demo"><span><UtensilsCrossed size={18}/></span>BẾP NHÀ</Link>; }
function Header({ hideCart = false }) {
  const { cart, table, myOrders } = useContext(AppContext);
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  return <header><Brand/><div className="header-actions">{table && <span className="table-pill">Bàn {table}</span>}{myOrders.length > 0 && <Link className="orders-link" to="/orders"><Clock3 size={17}/><span>Món đã gọi</span></Link>}{!hideCart && <Link className="cart-button" to="/cart"><ShoppingBag size={18}/>{count > 0 && <b>{count}</b>}</Link>}</div></header>;
}

function Demo() {
  const navigate = useNavigate(); const { setTable } = useContext(AppContext);
  const [tableInput, setTableInput] = useState("1");
  const tableNumber = parseDemoTable(tableInput);
  const open = () => {
    if (tableNumber === null) return;
    setTable(tableNumber); navigate(`/menu?table=${tableNumber}`);
  };
  const menuUrl = tableNumber === null ? null : `${window.location.origin}/menu?table=${tableNumber}`;
  return <main className="demo-page"><div className="demo-copy"><h1>Gọi món dễ dàng,<br/><em>thưởng thức cùng nhau.</em></h1><p>Quét mã, chọn món và gửi yêu cầu ngay tại bàn.</p><label htmlFor="demo-table">Số bàn (1–12)</label><input id="demo-table" type="number" min="1" max="12" step="1" required value={tableInput} onChange={event => setTableInput(event.target.value)} aria-invalid={tableNumber === null} aria-describedby={tableNumber === null ? "demo-table-error" : undefined}/>{tableNumber === null && <p id="demo-table-error" role="alert">Vui lòng nhập số bàn nguyên từ 1 đến 12.</p>}<button className="primary" disabled={tableNumber === null} onClick={open}>Vào bàn {tableNumber ?? ""} <span>→</span></button><Link className="staff-link" to="/kitchen">Vào màn hình bếp</Link></div><div className="qr-card"><div className="qr-top"><span>BÀN</span><strong>{tableNumber === null ? "—" : String(tableNumber).padStart(2, "0")}</strong></div><div className="qr">{menuUrl && <QRCodeSVG value={menuUrl} size={199} bgColor="#f2eee3" fgColor="#1e251f" level="M"/>}</div><h2>Quét mã để gọi món</h2></div></main>;
}

// Accent-insensitive search: "pho" matches "Phở".
const plain = text => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

function Menu() {
  const [menu, setMenu] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [search, setSearch] = useState(""), [activeCat, setActiveCat] = useState(""), [showAllCats, setShowAllCats] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const { cart, setCart, add, change, setTable } = useContext(AppContext); const location = useLocation(); const navigate = useNavigate();
  const tabsRef = useRef(null);
  useEffect(() => { const found = Number(new URLSearchParams(location.search).get("table")); if (Number.isInteger(found) && found > 0 && found <= 999) setTable(found); }, [location.search]);
  useEffect(() => {
    fetch(`${API}/menu`).then(readJson).then(data => {
      setMenu(data);
      // Existing carts keep quantities/notes while picking up the new photo sources.
      setCart(items => items.map(item => {
        const current = data.find(dish => dish.id === item.id);
        return current ? {...item, image:current.image} : item;
      }));
    }).catch(error => setError(errorText(error))).finally(()=>setLoading(false));
  }, []);

  const query = plain(search.trim());
  const visible = menu.filter(item => plain(item.name).includes(query) || plain(item.category).includes(query));
  const categories = [...new Set(visible.map(item => item.category))];
  const sections = categories.map(name => ({ name, items: visible.filter(item => item.category === name) }));
  const qtyOf = id => cart.find(item => item.id === id)?.quantity || 0;
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const sectionId = name => `cat-${plain(name).replace(/[^a-z0-9]+/g, "-")}`;
  const catsKey = categories.join("|");

  // Scroll spy: highlight the tab of the section currently under the sticky tab bar.
  useEffect(() => {
    if (!categories.length) return;
    setActiveCat(current => categories.includes(current) ? current : categories[0]);
    const observer = new IntersectionObserver(entries => {
      entries.filter(entry => entry.isIntersecting).forEach(entry => setActiveCat(entry.target.dataset.cat));
    }, { rootMargin: "-60px 0px -70% 0px" });
    categories.forEach(name => { const el = document.getElementById(sectionId(name)); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [catsKey]);
  // Keep the active tab visible inside the horizontal tab strip.
  useEffect(() => {
    const strip = tabsRef.current; const tab = strip?.querySelector(`[data-tab="${CSS.escape(activeCat)}"]`);
    if (strip && tab) strip.scrollTo({ left: tab.offsetLeft - 16, behavior: "smooth" });
  }, [activeCat]);
  useEffect(() => {
    if (!cartOpen) return;
    const previous = document.body.style.overflow;
    const closeOnEscape = event => { if (event.key === "Escape") setCartOpen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", closeOnEscape); };
  }, [cartOpen]);
  useEffect(() => { if (count === 0) setCartOpen(false); }, [count]);
  const jumpTo = name => { setActiveCat(name); setShowAllCats(false); document.getElementById(sectionId(name))?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  return <><Header hideCart/><main className={`m-menu ${count ? "has-bar" : ""}`}>
    <label className="m-search"><Search size={17}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Tìm món"/>{search&&<button onClick={()=>setSearch("")} aria-label="Xóa tìm kiếm"><X size={16}/></button>}</label>
    {categories.length>0&&<nav className="m-tabs">
      <div className="m-tab-strip" ref={tabsRef}>{categories.map(name=><button key={name} data-tab={name} className={activeCat===name?"active":""} onClick={()=>jumpTo(name)}>{name}</button>)}</div>
      <button className={`m-tab-toggle ${showAllCats?"open":""}`} onClick={()=>setShowAllCats(open=>!open)} aria-label="Tất cả danh mục"><ChevronDown size={22}/></button>
      {showAllCats&&<div className="m-tab-panel">{sections.map(section=><button key={section.name} className={activeCat===section.name?"active":""} onClick={()=>jumpTo(section.name)}><span>{section.name}</span><small>{section.items.length}</small></button>)}</div>}
    </nav>}
    {loading && <State text="Đang tải thực đơn…"/>}{error && <State text={error}/>} 
    {!loading&&!error&&visible.length===0&&<State text={`Không tìm thấy món phù hợp với “${search}”`}/>} 
    {sections.map(section=><section className="m-section" id={sectionId(section.name)} data-cat={section.name} key={section.name}>
      <h2>{section.name} ({section.items.length})</h2>
      {section.items.map(item=>{ const qty=qtyOf(item.id); return <article className={`m-item ${!item.available?"sold-out":""}`} key={item.id}>
        <div className="m-photo"><img src={item.image} alt={item.name} onError={onImgError} loading="lazy"/>{item.popular&&item.available&&<span className="m-tag">Được yêu thích</span>}</div>
        <div className="m-info">
          <h3>{item.name}</h3>
          <p className="m-desc">{item.description}</p>
          <div className="m-bottom">
            <strong>{money(item.price)}</strong>
            {!item.available ? <span className="m-out">Hết món</span>
              : qty===0 ? <button className="m-btn plus" onClick={()=>add(item)} aria-label={`Thêm ${item.name}`}><Plus size={20}/></button>
              : <div className="m-stepper"><button className="m-btn minus" onClick={()=>change(item.id,qty-1)} aria-label={`Giảm một ${item.name}`}><Minus size={18}/></button><b>{qty}</b><button className="m-btn plus" onClick={()=>add(item)} aria-label={`Thêm ${item.name}`}><Plus size={20}/></button></div>}
          </div>
        </div>
      </article>; })}
    </section>)}
  </main>
  <div className={`m-cartbar ${count?"show":""}`} aria-hidden={!count}>
    <button className="m-cart-summary" onClick={()=>setCartOpen(true)} tabIndex={count?0:-1} aria-label={`Mở giỏ hàng có ${count} món`}>
      <span className="m-basket"><ShoppingBag size={30}/>{count>0&&<b>{count}</b>}</span>
      <strong>{money(total)}</strong>
    </button>
    <button className="m-continue" onClick={()=>setCartOpen(true)} tabIndex={count?0:-1}>Xem giỏ hàng</button>
  </div>
  {cartOpen&&<div className="cart-sheet-layer" onMouseDown={event=>{if(event.target===event.currentTarget)setCartOpen(false)}}>
    <section className="cart-sheet" role="dialog" aria-modal="true" aria-labelledby="cart-sheet-title">
      <div className="cart-sheet-handle"/>
      <div className="cart-sheet-head"><div><span className="eyebrow">GỌI MÓN TẠI BÀN</span><h2 id="cart-sheet-title">Giỏ hàng</h2></div><button onClick={()=>setCartOpen(false)} aria-label="Đóng giỏ hàng"><X size={21}/></button></div>
      <div className="cart-sheet-items">{cart.map(item=><article className="cart-sheet-item" key={item.id}>
        <img src={item.image} alt="" onError={onImgError}/>
        <div className="cart-sheet-info"><h3>{item.name}</h3><span>{money(item.price)}</span></div>
        <div className="cart-sheet-stepper"><button onClick={()=>change(item.id,item.quantity-1)} aria-label={`Giảm một ${item.name}`}><Minus size={15}/></button><b>{item.quantity}</b><button onClick={()=>add(item)} aria-label={`Thêm một ${item.name}`}><Plus size={15}/></button></div>
      </article>)}</div>
      <div className="cart-sheet-foot"><div><span>Tổng tiền · {count} món</span><strong>{money(total)}</strong></div><button onClick={()=>{setCartOpen(false);navigate("/cart")}}>Kiểm tra món <span>→</span></button></div>
    </section>
  </div>}
  </>;
}
function State({text}) { return <div className="state"><Clock3/> {text}</div>; }

const newToken = () => (crypto.randomUUID ? crypto.randomUUID() : `t${Date.now()}${Math.random().toString(36).slice(2)}`);

function Cart() {
  const { cart, change, setCart, table, rememberOrder } = useContext(AppContext); const navigate = useNavigate();
  const [submitting,setSubmitting]=useState(false), [error,setError]=useState("");
  // One token per basket: tapping twice (or a retry over a slow network) reuses
  // the same order instead of sending the kitchen a duplicate.
  const token = useRef(newToken());
  const total = cart.reduce((sum,item)=>sum+item.price*item.quantity,0);
  const submit = async () => { setSubmitting(true); setError(""); try { const res=await fetch(`${API}/orders`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tableNumber:table,clientToken:token.current,items:cart.map(({id,quantity,note})=>({menuItemId:id,quantity,note}))})}); const data=await readJson(res); token.current=newToken(); rememberOrder(data.id); setCart([]); navigate(`/order/${data.id}`); } catch(error){setError(errorText(error))} finally{setSubmitting(false)} };
  return <><Header/><main className="narrow"><Link className="back" to="/menu"><ArrowLeft size={16}/> Quay lại thực đơn</Link><div className="page-title"><span className="eyebrow">BÀN {table || "—"}</span><h1>Món đã chọn</h1><p>Kiểm tra món đã chọn trước khi gửi đến bếp.</p></div>{cart.length===0?<div className="empty"><ShoppingBag/><h2>Giỏ hàng chưa có món</h2><Link className="primary" to="/menu">Xem thực đơn</Link></div>:<div className="cart-layout"><section className="cart-list">{cart.map(item=><article className="cart-row" key={item.id}><img src={item.image} alt="" onError={onImgError}/><div className="cart-name"><h3>{item.name}</h3><span>{money(item.price)}</span><input value={item.note} onChange={event=>setCart(items=>items.map(row=>row.id===item.id?{...row,note:event.target.value}:row))} maxLength={120} placeholder="Ghi chú cho món"/></div><div className="stepper"><button onClick={()=>change(item.id,item.quantity-1)}><Minus size={15}/></button><b>{item.quantity}</b><button onClick={()=>change(item.id,item.quantity+1)}><Plus size={15}/></button></div></article>)}</section><aside className="summary"><h2>Chi tiết thanh toán</h2><div><span>Tạm tính</span><strong>{money(total)}</strong></div><div><span>Phí phục vụ</span><strong>Đã bao gồm</strong></div><hr/><div className="summary-total"><span>Tổng tiền</span><strong>{money(total)}</strong></div>{error&&<p className="error">{error}</p>}{!table&&<p className="error">Chưa xác định được bàn. Vui lòng quét mã QR tại bàn.</p>}<button className="primary full" disabled={submitting||!table} onClick={submit}>{submitting?"Đang gửi…":"Gọi món"} <span>→</span></button><small>Món bạn gọi sẽ được gửi ngay đến bếp.</small></aside></div>}</main></>;
}

function OrderTracking(){ const {id}=useParams(); const [order,setOrder]=useState(null),[error,setError]=useState("");
  const { forgetPaidOrders } = useContext(AppContext);
  useEffect(()=>{
    const apply=data=>{setOrder(data);setError("");forgetPaidOrders([data])};
    const loadOrder=()=>fetch(`${API}/orders/${id}`).then(readJson).then(apply).catch(e=>setError(errorText(e)));
    loadOrder();
    const source=new EventSource(`${API}/events`);
    // "connected" fires on every (re)connect, so updates missed while offline are fetched again.
    source.addEventListener("connected",loadOrder);
    source.addEventListener("order-updated",event=>{const next=JSON.parse(event.data);if(String(next.id)===id)apply(next)});
    return()=>source.close();
  },[id]);
  if(error)return <><Header/><State text={error}/></>; if(!order)return <><Header/><State text="Đang tải món đã gọi…"/></>;
  const cancelled = order.status === "cancelled";
  return <><Header/><main className="tracking">
    <div className={`success-mark ${cancelled ? "cancelled" : ""}`}>{cancelled ? <X/> : <Check/>}</div>
    <span className="eyebrow">BÀN {order.tableNumber}</span>
    <h1>{cancelled ? "Đã hủy món" : "Đã nhận món"}</h1>
    {cancelled && <p>Nhà hàng đã hủy món trong lần gọi này. Vui lòng liên hệ nhân viên để được hỗ trợ.</p>}
    <section className="order-receipt">
      <div><h2>Chi tiết món đã gọi</h2><span>{new Date(order.createdAt).toLocaleTimeString("vi-VN", {hour:"2-digit", minute:"2-digit"})}</span></div>
      {order.items.map((item,index)=><p key={index}><span>{item.quantity}× {item.name}</span><strong>{money(item.price*item.quantity)}</strong></p>)}
      <footer><span>Tổng tiền</span><strong>{money(order.total)}</strong></footer>
    </section>
    <div className="tracking-links"><Link className="staff-link" to="/menu">Gọi thêm món</Link><Link className="staff-link" to="/orders">Xem món đã gọi</Link></div>
  </main></>;
}

function MyOrders() {
  const { myOrders, table, forgetPaidOrders } = useContext(AppContext);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const idsKey = myOrders.join(",");
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    if (!idsKey) { setOrders([]); setLoading(false); return; }
    const ids = new Set(idsKey.split(",").map(Number));
    const load = () => fetch(`${API}/orders?ids=${idsKey}`, {signal:controller.signal})
      .then(readJson)
      .then(data => { if(live) {setOrders(data); setError(""); forgetPaidOrders(data);} })
      .catch(e => { if(live && e.name !== "AbortError") setError(errorText(e)); })
      .finally(() => { if(live) setLoading(false); });
    load();
    const source = new EventSource(`${API}/events`);
    source.addEventListener("connected", load);
    source.addEventListener("order-updated", event => {
      const next = JSON.parse(event.data);
      if (live && ids.has(next.id)) setOrders(list => list.map(order => order.id === next.id ? next : order));
    });
    return () => { live = false; controller.abort(); source.close(); };
  }, [idsKey]);
  const { items, total } = useMemo(() => summarizeOrders(orders, table), [orders, table]);
  return <><Header/><main className="narrow my-bill">
    <Link className="back" to="/menu"><ArrowLeft size={16}/> Quay lại thực đơn</Link>
    <div className="page-title"><h1>Món đã gọi</h1></div>
    {loading && <State text="Đang tải món đã gọi…"/>}
    {error && <p role="alert" className="error">{error}</p>}
    {!loading && !error && <section className="bill-panel" aria-label="Món đã gọi">
      {items.length === 0 ? <div className="bill-empty"><ShoppingBag size={32}/><h2>Chưa có món đã gọi</h2><Link className="staff-link" to="/menu">Xem thực đơn</Link></div> :
      <ul className="bill-items">{items.map(item => <li className="bill-row" key={item.id}>
        <img src={item.image || FALLBACK_IMG} alt={item.name} onError={onImgError} loading="lazy"/>
        <div className="bill-name"><h2>{item.name}</h2><span>{item.prices.length === 1 ? money(item.prices[0]) : item.prices.map(money).join(" / ")}</span></div>
        <div className="bill-amount"><span aria-label={`Số lượng ${item.quantity}`}>× {item.quantity}</span><strong>{money(item.subtotal)}</strong></div>
      </li>)}</ul>}
      {items.length > 0 && <footer className="bill-total"><span>Tạm tính tiền</span><strong>{money(total)}</strong></footer>}
    </section>}
  </main></>;
}

function Kitchen(){ const [orders,setOrders]=useState([]),[filter,setFilter]=useState("active"),[error,setError]=useState("");
  const load=()=>fetch(`${API}/orders`).then(readJson).then(data=>{setOrders(data);setError("")}).catch(e=>setError(errorText(e)));
  useEffect(()=>{load(); const source=new EventSource(`${API}/events`); ["connected","order-created","order-updated"].forEach(name=>source.addEventListener(name,load)); return()=>source.close()},[]);
  const update=async(id,status)=>{if(status==="cancelled"&&!window.confirm(`Hủy đơn số ${id}?`))return; try{await readJson(await fetch(`${API}/orders/${id}/status`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})}));setError("")}catch(e){setError(errorText(e))}};
  const visible=orders.filter(order=>filter==="all"||!["completed","cancelled"].includes(order.status));
  return <div className="kitchen"><header><Brand/><div className="kitchen-title"><ChefHat/><span>Màn hình bếp</span></div><span className="live"><i/> Đang cập nhật</span></header><main><div className="kitchen-heading"><div><span className="eyebrow">QUẢN LÝ ĐƠN</span><h1>Đơn gọi món</h1></div><div className="segmented"><button className={filter==="active"?"active":""} onClick={()=>setFilter("active")}>Đang xử lý</button><button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>Tất cả đơn</button></div></div>{error&&<p className="error">{error}</p>}<section className="order-grid">{visible.map(order=><article className={`ticket ${order.status}`} key={order.id}><div className="ticket-head"><div><span>ĐƠN</span><strong>#{String(order.id).padStart(3,"0")}</strong></div><div><span>BÀN</span><strong>{order.tableNumber}</strong></div></div><div className="ticket-meta"><span className="status">{STATUS_LABELS[order.status]}</span><span>{new Date(order.createdAt).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"})}</span></div><div className="ticket-items">{order.items.map(item=><div key={item.menu_item_id}><b>{item.quantity}×</b><span>{item.name}{item.note&&<small>{item.note}</small>}</span></div>)}</div><footer>{order.status==="pending"&&<button onClick={()=>update(order.id,"preparing")}>Bắt đầu chế biến <span>→</span></button>}{order.status==="preparing"&&<button onClick={()=>update(order.id,"ready")}>Chế biến xong <Check size={17}/></button>}{order.status==="ready"&&<button onClick={()=>update(order.id,"completed")}>Đã phục vụ <Check size={17}/></button>}{order.status==="completed"&&<span className="complete"><Check/> Đã phục vụ</span>}{order.status==="cancelled"&&<span className="complete cancelled-label"><X/> Đã hủy</span>}{["pending","preparing"].includes(order.status)&&<button className="cancel-button" onClick={()=>update(order.id,"cancelled")}>Hủy đơn <X size={17}/></button>}</footer></article>)}{visible.length===0&&<div className="empty kitchen-empty"><ChefHat/><h2>{filter==="all"?"Chưa có đơn gọi món":"Không có đơn đang xử lý"}</h2><p>Đơn mới sẽ tự động hiện tại đây.</p></div>}</section></main></div>}

function App(){return <BrowserRouter><AppProvider><Routes><Route path="/demo" element={<Demo/>}/><Route path="/menu" element={<Menu/>}/><Route path="/cart" element={<Cart/>}/><Route path="/order/:id" element={<OrderTracking/>}/><Route path="/orders" element={<MyOrders/>}/><Route path="/kitchen" element={<RequireStaff roles={["kitchen","manager"]}><Kitchen/></RequireStaff>}/><Route path="/cashier" element={<Cashier/>}/><Route path="/menu-admin" element={<MenuAdmin/>}/><Route path="*" element={<Navigate to="/demo" replace/>}/></Routes></AppProvider></BrowserRouter>}
createRoot(document.getElementById("root")).render(<App/>);

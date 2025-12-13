const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);

let data=JSON.parse(localStorage.getItem("shiftData"))||{requests:[],delivered:[]};
let editContext=null;

function haptic(){ if(navigator.vibrate) navigator.vibrate(10); }

function save(){ localStorage.setItem("shiftData",JSON.stringify(data)); }

function switchScreen(name){
  haptic();
  $$(".screen").forEach(s=>s.classList.remove("active"));
  $$(".nav-btn").forEach(b=>b.classList.remove("active"));
  $("#screen-"+name).classList.add("active");
  document.querySelector(`[data-screen="${name}"]`).classList.add("active");
}

$$(".nav-btn").forEach(b=>b.onclick=()=>switchScreen(b.dataset.screen));

function render(){
  $("#requestsList").innerHTML=data.requests.map((r,i)=>`
    <div class="card">
      <div class="card-title">Заявка №${r.num}</div>
      <div class="card-meta">${r.addr||""}</div>
      <div class="card-actions">
        <button class="edit" onclick="editRequest(${i})">Изменить</button>
        <button class="delete" onclick="deleteRequest(${i})">Удалить</button>
      </div>
    </div>`).join("");

  $("#deliveredList").innerHTML=data.delivered.map((d,i)=>`
    <div class="card">
      <div class="card-title">${d.name}</div>
      <div class="card-meta">${d.time||""} • ${d.reason||""}</div>
      <div class="card-actions">
        <button class="edit" onclick="editDelivered(${i})">Изменить</button>
        <button class="delete" onclick="deleteDelivered(${i})">Удалить</button>
      </div>
    </div>`).join("");
}

function openModal(title,fields,onSubmit){
  haptic();
  $("#modalTitle").textContent=title;
  const f=$("#modalForm"); f.innerHTML="";
  fields.forEach(x=>f.innerHTML+=`<label>${x.label}</label>${x.html}`);
  f.onsubmit=e=>{e.preventDefault();onSubmit(new FormData(f));closeModal();};
  $("#modal").classList.remove("hidden");
}

function closeModal(){ $("#modal").classList.add("hidden"); editContext=null; }

$("#cancelModal").onclick=closeModal;

$("#addRequestBtn").onclick=()=>openModal("Новая заявка",[
  {label:"Номер заявки",html:'<input name="num" required>'},
  {label:"Тип",html:'<select name="type"><option>Адрес</option><option>Улица</option></select>'},
  {label:"Время получения",html:'<input name="t1">'},
  {label:"Время прибытия",html:'<input name="t2">'},
  {label:"Время убытия",html:'<input name="t3">'},
  {label:"КУСП",html:'<input name="kusp">'},
  {label:"Адрес",html:'<input name="addr">'},
  {label:"Описание",html:'<textarea name="desc"></textarea>'},
  {label:"Результат",html:'<input name="result">'}
],fd=>{const o=Object.fromEntries(fd.entries());editContext!==null?data.requests[editContext]=o:data.requests.push(o);save();render();});

$("#addDeliveredBtn").onclick=()=>openModal("Доставленный",[
  {label:"ФИО",html:'<input name="name" required>'},
  {label:"Время доставления",html:'<input name="time">'},
  {label:"Основание",html:'<input name="reason">'}
],fd=>{const o=Object.fromEntries(fd.entries());editContext!==null?data.delivered[editContext]=o:data.delivered.push(o);save();render();});

window.editRequest=i=>{editContext=i;$("#addRequestBtn").click();}
window.deleteRequest=i=>{haptic();data.requests.splice(i,1);save();render();}
window.editDelivered=i=>{editContext=i;$("#addDeliveredBtn").click();}
window.deleteDelivered=i=>{haptic();data.delivered.splice(i,1);save();render();}

render();

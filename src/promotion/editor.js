import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

const format = () => globalThis.TAEJANG_ARTICLE_DOCUMENT;
function mount(textarea, {getMedia = () => [], getTitle = () => '', item = null, preview = true} = {}) {
  if (!textarea || textarea._articleEditor) return textarea?._articleEditor;
  const f = format();
  if (!f || !textarea.parentNode) return null;
  const shell = document.createElement('div'); shell.className = 'article-editor';
  // A textarea's label must not wrap interactive editor controls.
  textarea.parentNode.after(shell);
  const toolbar = document.createElement('div'); toolbar.className = 'article-editor-toolbar'; toolbar.setAttribute('role','toolbar'); toolbar.setAttribute('aria-label','본문 편집 도구');
  const surface = document.createElement('div'); surface.className = 'taejang-article article-editor-surface';
  const status = document.createElement('p'); status.className = 'article-editor-status'; status.setAttribute('role','status');
  const imageTools = document.createElement('div'); imageTools.className = 'article-editor-images';
  const picker = document.createElement('select'); picker.setAttribute('aria-label','본문에 넣을 사진');
  const caption = document.createElement('input'); caption.type = 'text'; caption.maxLength = 300; caption.placeholder = '사진 설명 (선택)'; caption.setAttribute('aria-label','선택한 사진 설명');
  const previewTools = document.createElement('div'); previewTools.className = 'article-editor-toolbar';
  const output = document.createElement('div'); output.className = 'article-editor-preview'; output.hidden = true;
  shell.append(toolbar, surface, imageTools, status, previewTools, output);
  let synchronized = textarea.value;
  const damaged = f.isRich(synchronized) && !f.parse(synchronized);
  if (damaged) { shell.textContent = '본문 형식을 읽을 수 없습니다. 원문을 보존하기 위해 편집을 중단했습니다.'; textarea.hidden = true; textarea._articleEditor = {refresh(){},validate(){window.alert('본문 형식을 확인할 수 없어 저장하지 않았습니다.');return false;}}; return textarea._articleEditor; }
  let editor;
  const toggleButtons = [];
  const button = (parent, label, action) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('mousedown', e => e.preventDefault()); b.addEventListener('click', action); parent.append(b); return b;
  };
  function drawPreview() { output.innerHTML = f.render({public_body: f.PREFIX + JSON.stringify(editor.getJSON()), public_media:getMedia()}) || ''; const title=document.createElement('h1');title.textContent=getTitle();if(title.textContent)output.prepend(title); }
  function updated() {
    const doc = editor.getJSON();
    const value = editor.isEmpty ? '' : f.PREFIX + JSON.stringify(doc);
    textarea.value = value; synchronized = value;
    textarea.setCustomValidity(value.length > 30000 ? '본문이 저장 가능한 분량을 넘었습니다. 글을 나누거나 줄여 주세요.' : '');
    status.textContent = value.length > 30000 ? '저장 가능한 분량을 넘었습니다. 글을 줄여 주세요.' : '소제목과 사진 배치는 저장 후에도 유지됩니다.';
    textarea.dispatchEvent(new Event('input',{bubbles:true}));
    if (!output.hidden) drawPreview();
  }
  let originalDoc = f.parse(synchronized) || f.fromPlain(synchronized);
  const legacyHTML = !f.isRich(synchronized) && globalThis.TAEJANG_FEATURED_ARTICLE?.render(item);
  if (legacyHTML) {
    const legacy=document.createElement('div'); legacy.innerHTML=legacyHTML;
    legacy.querySelectorAll('figcaption').forEach(node=>node.remove());
    legacy.querySelectorAll('a').forEach(node=>node.replaceWith(...node.childNodes));
    originalDoc=legacy.innerHTML;
  }
  if (!legacyHTML && !f.isRich(synchronized) && synchronized.trim()) {
    getMedia().forEach(entry => { if (globalThis.TAEJANG_PUBLIC_MEDIA?.persistent(entry.url)) originalDoc.content.push({type:'image',attrs:{src:entry.url,alt:entry.alt || ''}}); });
  }
  function approvedDocument(doc) {
    if (typeof doc === 'string') return doc;
    const allowed=new Set(getMedia().filter(entry=>globalThis.TAEJANG_PUBLIC_MEDIA?.persistent(entry.url)).map(entry=>entry.url));
    const clean=node=>({...node,...(node.content ? {content:node.content.filter(child=>child.type!=='image'||allowed.has(child.attrs.src)).map(clean)} : {})});
    return clean(doc);
  }
  editor = new Editor({element:surface, extensions:[StarterKit.configure({heading:{levels:[2,3]},codeBlock:false,code:false,link:{openOnClick:false,autolink:false,protocols:['https','http']}}),Image.configure({allowBase64:false})],
    content:approvedDocument(originalDoc),
    editorProps:{attributes:{role:'textbox','aria-label':'기사 본문','aria-multiline':'true'},handlePaste(view,event){
      // Pasted remote images never bypass the approved attachment/upload path.
      const html = event.clipboardData?.getData('text/html');
      if (html && /<img\b/i.test(html)) { event.preventDefault(); view.dispatch(view.state.tr.insertText(event.clipboardData.getData('text/plain'))); return true; }
      return false;
    }, handleDrop(_view,event) { if (event.dataTransfer?.files.length || /<img\b/i.test(event.dataTransfer?.getData('text/html') || '')) {event.preventDefault(); status.textContent='사진은 아래 사진 추가 버튼으로 첨부한 뒤 본문에 넣어 주세요.'; return true;} return false; }},
    onUpdate:updated, onSelectionUpdate(){
      const active = editor.isActive('image'); caption.disabled = !active;
      caption.value = active ? editor.getAttributes('image').alt || '' : '';
      for (const [b,type] of toggleButtons) b.setAttribute('aria-pressed',String(editor.isActive(type)));
    }});
  const style = document.createElement('select'); style.setAttribute('aria-label','문단 스타일');
  for (const [value,label] of [['p','본문'],['2','소제목'],['3','작은 소제목']]) { const o = new Option(label,value); style.add(o); }
  style.addEventListener('change',()=> style.value === 'p' ? editor.chain().focus().setParagraph().run() : editor.chain().focus().setHeading({level:Number(style.value)}).run()); toolbar.append(style);
  for (const [label,command,type] of [['굵게','toggleBold','bold'],['인용','toggleBlockquote','blockquote'],['목록','toggleBulletList','bulletList'],['번호 목록','toggleOrderedList','orderedList']]) {
    const b = button(toolbar,label,()=>editor.chain().focus()[command]().run()); b.setAttribute('aria-pressed','false'); toggleButtons.push([b,type]);
  }
  button(toolbar,'링크',()=>{ const raw = window.prompt('연결할 웹 주소 (비우면 링크 해제)',editor.getAttributes('link').href || ''); if(raw === null)return; if(!raw.trim()){editor.chain().focus().unsetLink().run();return;} const href=f.safeLink(raw.trim()); if(!href){window.alert('http 또는 https 웹 주소를 입력해 주세요.');return;} editor.chain().focus().setLink({href}).run(); });
  button(toolbar,'실행 취소',()=>editor.chain().focus().undo().run()); button(toolbar,'다시 실행',()=>editor.chain().focus().redo().run());
  imageTools.append(picker);
  button(imageTools,'본문에 사진 넣기',()=>{ const entry=getMedia().find(m=>m.url===picker.value); if(entry){editor.chain().focus().setImage({src:entry.url,alt:entry.alt || ''}).run();} else status.textContent='먼저 아래 사진 추가 버튼으로 사진을 첨부해 주세요.'; });
  imageTools.append(caption); caption.disabled = true;
  caption.addEventListener('input',()=> { if(editor.isActive('image'))editor.commands.updateAttributes('image',{alt:caption.value}); });
  function move(delta) {
    const selection=editor.state.selection;
    const index=selection.$from.index(0); const doc=editor.getJSON(); const target=index+delta;
    if(target<0 || target>=doc.content.length) return;
    [doc.content[index],doc.content[target]]=[doc.content[target],doc.content[index]];
    // One transaction preserves undo history and moves the selected top-level block.
    const replacement=editor.schema.nodeFromJSON(doc);
    let pos=0;for(let i=0;i<target;i++)pos+=replacement.child(i).nodeSize;
    editor.chain().focus().command(({tr})=>{closeHistory(tr);tr.replaceWith(0,tr.doc.content.size,replacement.content);tr.setSelection(replacement.child(target).type.name === 'image' ? NodeSelection.create(tr.doc,pos) : TextSelection.near(tr.doc.resolve(Math.min(pos+1,tr.doc.content.size))));return true;}).run();
  }
  button(imageTools,'문단·사진 위로',()=>move(-1)); button(imageTools,'문단·사진 아래로',()=>move(1));
  button(imageTools,'본문 사진 빼기',()=>{if(editor.isActive('image'))editor.chain().focus().deleteSelection().run();});
  if(preview) {
    button(previewTools,'PC 미리보기',()=>{output.hidden=false;output.classList.remove('is-mobile');drawPreview();});
    button(previewTools,'모바일 미리보기',()=>{output.hidden=false;output.classList.add('is-mobile');drawPreview();});
    button(previewTools,'미리보기 닫기',()=>{output.hidden=true;});
  }
  function refresh() {
    if (textarea.value !== synchronized) { synchronized=textarea.value; const doc=f.parse(synchronized); if(f.isRich(synchronized)&&!doc)return; editor.commands.setContent(approvedDocument(doc || f.fromPlain(synchronized)),{emitUpdate:false}); }
    const selected=picker.value;picker.replaceChildren(new Option('첨부한 사진 선택',''));
    getMedia().filter(entry => globalThis.TAEJANG_PUBLIC_MEDIA?.persistent(entry.url)).forEach((entry,i)=>picker.add(new Option(`${i+1}. ${entry.alt || '사진'}`,entry.url)));
    if(getMedia().some(m=>m.url===selected))picker.value=selected;
    const allowed=new Set(getMedia().map(entry=>entry.url));
    const removals=[];editor.state.doc.descendants((node,pos)=>{if(node.type.name==='image'&&!allowed.has(node.attrs.src))removals.push({pos,size:node.nodeSize});});
    if(removals.length){editor.chain().command(({tr})=>{removals.reverse().forEach(({pos,size})=>tr.delete(pos,pos+size));return true;}).run();}
    if(!output.hidden)drawPreview();
  }
  textarea.hidden=true;
  const api = {editor,refresh,validate(){if(textarea.value.length>30000){window.alert('본문이 저장 가능한 분량을 넘었습니다. 글을 줄여 주세요.');return false;}return !f.isRich(textarea.value)||!!f.parse(textarea.value);},destroy(){editor.destroy();shell.remove();textarea.hidden=false;delete textarea._articleEditor;}};
  textarea._articleEditor=api;
  refresh();
  return api;
}
globalThis.TaejangArticleEditor = Object.freeze({mount,valid:textarea=>textarea?._articleEditor?.validate() ?? true});

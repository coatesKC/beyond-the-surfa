'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const say = text => { $('status').textContent = text; };
  const hints = ['Who made your day a little brighter?', 'What small blessing did you almost overlook?', 'Where did you find a moment of peace?', 'What are you learning to appreciate?', 'What kindness did you receive or share?', 'What brought you joy today?', 'What helped you keep going?'];
  function daily() {
    const date = new Date();
    $('today').textContent = date.toLocaleDateString(undefined, {weekday:'long',month:'long',day:'numeric'});
    const day = Math.floor(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())/86400000);
    $('daily-hint').textContent = hints[day % hints.length];
  }
  daily(); setInterval(daily,60000);
  let db, user, admin = false, offset = 0, previewURL, email = '', generation = 0;
  const node = (tag,text,className) => { const el=document.createElement(tag); if(text!==undefined) el.textContent=text; if(className) el.className=className; return el; };
  async function run(button, task) {
    if(button.disabled) return;
    button.disabled=true;
    try { await task(); } catch(error) { say(error.message || 'Something went wrong. Please try again.'); }
    finally { button.disabled=false; }
  }
  function checked(result) { if(result.error) throw result.error; return result.data; }
  function requireUser() { if(!user) throw Error('Please sign in above to participate.'); }
  function displayName() { const name=$('display-name').value.trim(); if(!name) throw Error('Enter the name you want to share with the community.'); return name; }
  function clearPhoto() { if(previewURL) URL.revokeObjectURL(previewURL); previewURL=null; $('photo').value=''; $('preview').removeAttribute('src'); $('photo-preview').hidden=true; }
  $('remove-photo').onclick=clearPhoto;
  $('photo').onchange=()=>{
    const file=$('photo').files[0]; if(!file) return clearPhoto();
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){clearPhoto();say('Choose a JPG, PNG or WebP photo up to 5 MB.');return;}
    if(previewURL) URL.revokeObjectURL(previewURL);
    previewURL=URL.createObjectURL(file); $('preview').src=previewURL; $('photo-preview').hidden=false;
  };
  async function sessionChanged(session) {
    user=session?.user||null; admin=false;
    $('auth-area').hidden=!!user; $('post-form').hidden=!user;
    if(user) { const result=await db.rpc('gratitude_is_admin'); admin=result.data===true; }
    await feed(true);
  }
  function action(label,task) { const b=node('button',label,'quiet'); b.type='button'; b.onclick=()=>run(b,task); return b; }
  async function report(postId, commentId=null) {
    requireUser();
    const reason=window.prompt('Briefly explain your concern (up to 500 characters).');
    if(!reason?.trim()) return;
    checked(await db.from('gratitude_reports').insert({reporter:user.id,post_id:postId,comment_id:commentId,reason:reason.trim().slice(0,500)}));
    say('Thank you. Your report has been saved for the moderator.');
  }
  async function comments(post,box) {
    box.replaceChildren(node('p','Loading comments…'));
    try {
      const rows=checked(await db.from('gratitude_comments').select('*').eq('post_id',post.id).order('created_at',{ascending:false}).limit(50));
      box.replaceChildren();
      if(!rows.length) box.append(node('p','Be the first to offer an encouraging word.'));
      else box.append(node('p','Latest comments (up to 50)'));
      for(const row of rows) {
        const c=node('div',undefined,'comment'); c.append(node('strong',row.display_name),node('p',row.body,'post-text'));
        if(user) c.append(action('Report',()=>report(post.id,row.id)));
        if(user&&(user.id===row.user_id||admin)) c.append(action('Delete comment',async()=>{
          if(!confirm('Delete this comment?')) return;
          checked(await db.from('gratitude_comments').delete().eq('id',row.id)); await comments(post,box);
        }));
        box.append(c);
      }
      if(user) {
        const form=node('form');const label=node('label','Leave an encouraging comment');
        const input=node('textarea');input.id='comment-'+post.id;label.htmlFor=input.id;input.required=true;input.maxLength=1000;input.rows=2;
        const submit=node('button','Post comment','button');
        form.append(label,input,node('p','Your comment and display name will be public.','privacy'),submit);
        form.onsubmit=e=>{e.preventDefault();run(submit,async()=>{
          requireUser();const body=input.value.trim();if(!body)throw Error('Write a comment first.');
          checked(await db.from('gratitude_comments').insert({post_id:post.id,user_id:user.id,display_name:displayName(),body}));
          await comments(post,box);say('Your comment was posted.');
        });};box.append(form);
      } else box.append(node('p','Sign in above to leave a comment.'));
    } catch(error) {box.replaceChildren(node('p','Comments could not load. Close and reopen to retry.'));throw error;}
  }
  async function card(post) {
    const el=node('article',undefined,'card');const heading=node('div',undefined,'row');
    const time=node('time',new Date(post.created_at).toLocaleString());time.dateTime=post.created_at;
    heading.append(node('p',post.display_name,'post-name'),time);el.append(heading,node('p',post.body,'post-text'));
    if(post.image_path) {
      const result=await db.storage.from('gratitude-photos').createSignedUrl(post.image_path,300);
      if(result.data?.signedUrl) {const img=node('img');img.src=result.data.signedUrl;img.alt=post.image_alt||'A gratitude photo shared by '+post.display_name;img.className='post-photo';img.loading='lazy';el.append(img);}
      else el.append(node('p','Photo unavailable. Refresh to try again.'));
    }
    const details=node('details',undefined,'comments');const box=node('div');details.append(node('summary','Read comments & encourage'),box);
    details.ontoggle=()=>{if(details.open) comments(post,box).catch(e=>say(e.message));};el.append(details);
    const actions=node('div',undefined,'actions');
    if(user) actions.append(action('Report',()=>report(post.id)));
    if(user&&(user.id===post.user_id||admin)) actions.append(action('Delete post',async()=>{
      if(!confirm('Delete this post and its comments?'))return;
      checked(await db.from('gratitude_posts').delete().eq('id',post.id));
      if(post.image_path) await db.storage.from('gratitude-photos').remove([post.image_path]);
      await feed(true);say('Post deleted.');
    }));
    el.append(actions);return el;
  }
  async function feed(reset=false) {
    const request=++generation;
    if(reset) offset=0;
    const start=offset;
    try {
      const rows=checked(await db.from('gratitude_posts').select('*').order('created_at',{ascending:false}).order('id',{ascending:false}).range(start,start+19));
      const cards=await Promise.all(rows.map(card));if(request!==generation)return;
      if(reset)$('feed').replaceChildren();
      $('feed').append(...cards);
      if(reset&&!rows.length)$('feed').append(node('div','Every gratitude wall starts with one small blessing. Share yours above.','card'));
      offset=start+rows.length;$('more').hidden=rows.length<20;
    } catch(error) {say('The wall could not load. Please check your connection and press Refresh.');throw error;}
  }
  $('email-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{
    email=$('email').value.trim();checked(await db.auth.signInWithOtp({email}));
    $('code-form').hidden=false;$('code').focus();say('Check your email for a sign-in code. It may take a moment to arrive.');
  });};
  $('code-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{
    checked(await db.auth.verifyOtp({email,token:$('code').value.trim(),type:'email'}));
    $('code').value='';$('code-form').hidden=true;say('Welcome! Add your display name and share a blessing.');
  });};
  $('signout').onclick=()=>run($('signout'),async()=>{checked(await db.auth.signOut());$('post-form').reset();clearPhoto();say('You’re signed out.');});
  $('post-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{
    requireUser();const name=displayName(),body=$('message').value.trim(),file=$('photo').files[0];
    if(!body&&!file)throw Error('Add a few words or a photo first.');
    let imagePath=null;
    if(file) {
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Choose a JPG, PNG or WebP photo up to 5 MB.');
      imagePath=user.id+'/'+crypto.randomUUID()+({ 'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'}[file.type]);
      checked(await db.storage.from('gratitude-photos').upload(imagePath,file,{contentType:file.type,upsert:false}));
    }
    const result=await db.from('gratitude_posts').insert({user_id:user.id,display_name:name,body,image_path:imagePath,image_alt:$('photo-description').value.trim()});
    if(result.error){if(imagePath)await db.storage.from('gratitude-photos').remove([imagePath]);throw result.error;}
    $('message').value='';$('photo-description').value='';clearPhoto();say('Your gratitude is now on the wall. Thank you for sharing!');await feed(true);
  });};
  $('refresh').onclick=()=>run($('refresh'),()=>feed(true));$('more').onclick=()=>run($('more'),()=>feed());
  async function init() {
    const config=window.GRATITUDE_CONFIG;
    if(!config?.url||!config?.publishableKey){say('Our gratitude wall is coming soon. Posting and sign-in will open once setup is complete.');return;}
    const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
    db=createClient(config.url,config.publishableKey);
    db.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>sessionChanged(session).catch(e=>say(e.message)),0);});
    $('email-form').querySelector('button').disabled=false;$('refresh').disabled=false;
  }
  init().catch(()=>say('We couldn’t connect to the gratitude wall. Please check your internet connection and reload.'));
  if('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(()=>{});
})();

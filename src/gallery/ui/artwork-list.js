function addListItem(i) {
  const m = ART[i].meta, b = document.createElement('button');
  b.className = 'item'; b.dataset.idx = i;
  b.innerHTML = '<span></span><small></small>';
  b.firstChild.textContent = m.title; b.querySelector('small').textContent = [m.artist, m.year].filter(Boolean).join(' · ');
  document.getElementById('list').appendChild(b);
}
ART.forEach((a, i) => addListItem(i));


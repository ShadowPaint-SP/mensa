// Like the swipe picker, the machine uses a snapshot of already-filtered meals.
export function createMealSlot({ button, dialog, renderCard }) {
  const track = dialog.querySelector('.slot-track');
  const lever = dialog.querySelector('.slot-lever');
  const status = dialog.querySelector('.slot-status');
  const context = dialog.querySelector('.slot-context');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let available = [];
  let generation = 0;
  let busy = false;
  let current;
  let reelAnimation;
  let leverAnimation;
  let stemAnimation;
  let revealAnimations = [];
  let confettiLayer;
  let confettiAnimations = [];

  function clearConfetti() {
    confettiAnimations.forEach((animation) => animation.cancel());
    confettiAnimations = [];
    confettiLayer?.remove();
    confettiLayer = undefined;
  }

  function clearReveal() {
    revealAnimations.forEach((animation) => animation.cancel());
    revealAnimations = [];
  }

  function reveal(node) {
    clearReveal();
    if (motion.matches) return;
    revealAnimations = [
      node.querySelector('.meal-content').animate([
        { transform: 'translateY(100%)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1 }
      ], { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)' }),
      node.querySelector('.slot-canteen').animate([
        { transform: 'translateY(-8px)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1 }
      ], { duration: 300, delay: 140, easing: 'ease-out', fill: 'backwards' })
    ];
  }

  function celebrate() {
    clearConfetti();
    if (motion.matches) return;
    const layer = document.createElement('div');
    layer.className = 'slot-confetti';
    layer.setAttribute('aria-hidden', 'true');
    layer.inert = true;
    dialog.querySelector('.slot-machine').append(layer);
    confettiLayer = layer;
    const width = layer.clientWidth;
    const height = layer.clientHeight;
    const colors = ['var(--mint)', 'var(--accent)', 'var(--ink)'];
    for (let i = 0; i < 42; i++) {
      const piece = document.createElement('span');
      piece.style.background = colors[i % colors.length];
      const fromLeft = i % 2 === 0;
      const spread = (i % 21) / 20;
      piece.style.left = fromLeft ? '3%' : '97%';
      piece.style.width = `${5 + Math.random() * 4}px`;
      piece.style.height = `${8 + Math.random() * 7}px`;
      if (i % 4 === 0) piece.style.borderRadius = '50%';
      layer.append(piece);
      const distance = (fromLeft ? 1 : -1) * width * (.25 + spread * .6 + Math.random() * .1);
      const upwardVelocity = -height * (2.5 + Math.random() * .5);
      const rotation = (Math.random() - .5) * 1440;
      // Sample a ballistic arc: an outward burst, upward lift, then gravity and flutter.
      const frames = Array.from({ length: 17 }, (_, step) => {
        const t = step / 16;
        const x = distance * (1 - (1 - t) ** 1.6);
        const y = upwardVelocity * t + height * 3.4 * t * t;
        const flutter = Math.cos(t * 12 + i) * .65 + .35;
        return {
          offset: t,
          transform: `translate3d(${x}px,${y}px,0) rotate(${rotation * t}deg) scaleX(${flutter})`,
          opacity: t < .1 ? t * 10 : t > .8 ? (1 - t) * 5 : 1
        };
      });
      const animation = piece.animate(frames, {
        duration: 1700 + Math.random() * 500, delay: Math.random() * 90, easing: 'linear', fill: 'both'
      });
      animation.finished.then(() => {
        piece.remove();
        if (!layer.childElementCount && confettiLayer === layer) {
          layer.remove();
          confettiLayer = undefined;
          confettiAnimations = [];
        }
      }, () => { /* Closing, another spin or reduced motion cancels the burst. */ });
      confettiAnimations.push(animation);
    }
  }

  function entry({ meal, canteen }) {
    const node = document.createElement('div');
    node.className = 'slot-entry';
    const heading = document.createElement('h3');
    heading.className = 'slot-canteen';
    heading.textContent = canteen.name;
    node.append(heading, renderCard(meal));
    return node;
  }

  function stop() {
    generation++;
    clearConfetti();
    clearReveal();
    reelAnimation?.cancel();
    leverAnimation?.cancel();
    stemAnimation?.cancel();
    reelAnimation = leverAnimation = stemAnimation = undefined;
    busy = false;
    dialog.classList.remove('is-spinning');
    track.setAttribute('aria-busy', 'false');
    lever.disabled = available.length === 0;
  }

  function preview() {
    const node = entry(current || available[0]);
    node.inert = !current;
    if (!current) node.setAttribute('aria-hidden', 'true');
    track.replaceChildren(node);
    track.style.transform = '';
  }

  function open() {
    if (!available.length) return;
    stop();
    preview();
    status.textContent = current ? 'Dein Zufallsgericht. Noch einmal ziehen?' : 'Hebel ziehen, um ein Gericht auszuwählen.';
    dialog.showModal();
    document.body.classList.add('picker-open');
    lever.focus();
  }

  async function spin() {
    if (busy || !dialog.open || !available.length) return;
    clearConfetti();
    clearReveal();
    busy = true;
    const version = ++generation;
    // Choose once, uniformly across meal/cafeteria pairs. Animation never changes the result.
    const winner = available[Math.floor(Math.random() * available.length)];
    lever.disabled = true;
    dialog.classList.add('is-spinning');
    track.setAttribute('aria-busy', 'true');
    status.textContent = 'Die Gerichte drehen sich …';
    const frames = motion.matches ? [winner] : [
      current || available[0],
      ...Array.from({ length: 17 }, () => available[Math.floor(Math.random() * available.length)]),
      winner
    ];
    const nodes = frames.map((meal) => {
      const node = entry(meal);
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
      return node;
    });
    track.replaceChildren(...nodes);
    const winningPhoto = nodes[nodes.length - 1].querySelector('img');
    if (winningPhoto) winningPhoto.loading = 'eager';
    if (!motion.matches) {
      const distance = (nodes.length - 1) * nodes[0].getBoundingClientRect().height;
      const pullTiming = { duration: 760, easing: 'ease-in-out' };
      leverAnimation = lever.querySelector('.slot-knob').animate([
        { transform: 'translateY(0)' },
        { transform: 'translateY(64px)', offset: .34 },
        { transform: 'translateY(64px)', offset: .5 },
        { transform: 'translateY(-3px)', offset: .86 },
        { transform: 'translateY(0)' }
      ], pullTiming);
      stemAnimation = lever.querySelector('.slot-stem').animate([
        { transform: 'scaleY(1)' },
        { transform: 'scaleY(.48)', offset: .34 },
        { transform: 'scaleY(.48)', offset: .5 },
        { transform: 'scaleY(1.025)', offset: .86 },
        { transform: 'scaleY(1)' }
      ], pullTiming);
      reelAnimation = track.animate([
        { transform: 'translateY(0)' },
        { transform: `translateY(-${distance}px)` }
      ], { duration: 2800, easing: 'cubic-bezier(.12,.65,.15,1)', fill: 'forwards' });
      try { await reelAnimation.finished; } catch { return; }
    }
    if (version !== generation || !dialog.open) return;
    current = winner;
    // Reuse the actual landing photo; never replace, shrink or reload it on reveal.
    const winningNode = nodes[nodes.length - 1];
    winningNode.inert = false;
    winningNode.removeAttribute('aria-hidden');
    track.replaceChildren(winningNode);
    track.style.transform = '';
    reelAnimation?.cancel();
    leverAnimation?.cancel();
    stemAnimation?.cancel();
    reelAnimation = leverAnimation = stemAnimation = undefined;
    busy = false;
    dialog.classList.remove('is-spinning');
    track.setAttribute('aria-busy', 'false');
    lever.disabled = false;
    status.textContent = `Dein Zufallsgericht ist bereit. ${winner.canteen.name}`;
    reveal(winningNode);
    celebrate();
    lever.focus();
  }

  lever.addEventListener('click', spin);
  button.addEventListener('click', open);
  dialog.querySelector('.slot-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    stop();
    document.body.classList.remove('picker-open');
  });
  motion.addEventListener('change', () => {
    if (motion.matches) {
      clearConfetti();
      clearReveal();
      if (busy) {
        reelAnimation?.finish();
        leverAnimation?.finish();
        stemAnimation?.finish();
      }
    }
  });
  return {
    setMeals(meals, { dateLabel = '', unavailableCount = 0 } = {}) {
      stop();
      if (dialog.open) dialog.close();
      available = [...meals];
      current = undefined;
      track.replaceChildren();
      context.textContent = `${dateLabel} · ${meals.length} passende Gerichte${unavailableCount ? ` · ${unavailableCount} Mensa-Speisepläne nicht abrufbar; nur geladene Gerichte enthalten.` : ''}`;
      status.textContent = '';
      button.disabled = lever.disabled = meals.length === 0;
      button.title = meals.length ? 'Ein Zufallsgericht aus deiner aktuellen Auswahl ziehen' : 'Keine passenden Gerichte verfügbar';
    }
  };
}

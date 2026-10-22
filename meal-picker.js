import { horizontalSwipe } from './swipe.js';

// A session is a snapshot of the currently displayed menus, never a separate API query.
export function createMealPicker({ button, dialog, renderCard }) {
  const body = dialog.querySelector('#picker-body');
  const close = dialog.querySelector('#close-picker');
  let available = [];
  let context = '';
  let session = [];
  let liked = [];
  let index = 0;
  let busy = false;
  let generation = 0;
  let animation;
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function node(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }

  function reset() {
    generation++;
    animation?.cancel();
    animation = undefined;
    session = [];
    liked = [];
    index = 0;
    busy = false;
    body.replaceChildren();
    dialog.classList.remove('is-voting');
    document.body.classList.remove('picker-open');
  }

  function start() {
    if (!available.length) return;
    generation++;
    session = [...available];
    liked = [];
    index = 0;
    busy = false;
    render();
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    document.body.classList.add('picker-open');
  }

  function results() {
    dialog.classList.remove('is-voting');
    body.replaceChildren(node('p', 'picker-context', context));
    const heading = node('h3', 'picker-results-heading', `Deine Auswahl · ${liked.length} ${liked.length === 1 ? 'Gericht' : 'Gerichte'}`);
    heading.tabIndex = -1;
    body.append(heading);
    if (!liked.length) {
      body.append(node('p', 'picker-empty', 'Du hast kein Gericht geliked.'));
    } else {
      const list = node('ul', 'picker-results');
      liked.forEach(({ meal, canteen }) => {
        const item = node('li');
        item.append(node('h4', 'picker-canteen', canteen.name), renderCard(meal));
        list.append(item);
      });
      body.append(list);
    }
    const restart = node('button', 'picker-start', 'Noch einmal swipen');
    restart.type = 'button';
    restart.addEventListener('click', start);
    body.append(restart);
    heading.focus();
  }

  function render() {
    if (index === session.length) { results(); return; }
    dialog.classList.add('is-voting');
    const { meal, canteen } = session[index];
    const progress = node('p', 'picker-progress', `${index + 1} von ${session.length} · ${liked.length} geliked`);
    progress.setAttribute('role', 'status');
    const heading = node('h3', 'picker-canteen', canteen.name);
    heading.tabIndex = -1;
    const stage = node('div', 'picker-stage');
    const card = renderCard(meal);
    card.classList.add('picker-current-card');
    const stamp = node('span', 'picker-stamp');
    stamp.setAttribute('aria-hidden', 'true');
    card.append(stamp);
    stage.append(card);
    const nextEntry = session[index + 1];
    if (nextEntry) {
      const nextCard = renderCard(nextEntry.meal);
      nextCard.classList.add('picker-next-card');
      nextCard.inert = true;
      nextCard.setAttribute('aria-hidden', 'true');
      nextCard.querySelector('.meal-category').textContent =
        `${nextEntry.canteen.name} · ${nextEntry.meal.category || 'Tagesgericht'}`;
      // Load the actual next photo before it is revealed by the outgoing card.
      const image = nextCard.querySelector('img');
      if (image) image.loading = 'eager';
      stage.append(nextCard);
    }
    const actions = node('div', 'picker-actions');
    const reject = node('button', 'picker-action picker-reject', '✕ Nein danke');
    const like = node('button', 'picker-action picker-like', '♡ Gefällt mir');
    let settleAnimation;
    reject.type = like.type = 'button';
    actions.append(reject, like);
    body.replaceChildren(node('p', 'picker-context', context), progress, heading, stage, actions);

    async function decide(keep) {
      if (busy || !dialog.open) return;
      settleAnimation?.cancel();
      busy = true;
      reject.disabled = like.disabled = true;
      const currentGeneration = generation;
      stamp.textContent = keep ? 'LIKE' : 'NEIN';
      stamp.className = `picker-stamp ${keep ? 'is-like' : 'is-reject'}`;
      stamp.style.opacity = '1';
      if (!reducedMotion()) {
        const direction = keep ? 1 : -1;
        animation = card.animate([
          { transform: card.style.transform || 'translateX(0) rotate(0deg)', opacity: 1 },
          { transform: `translateX(${direction * (stage.clientWidth + 100)}px) rotate(${direction * 20}deg)`, opacity: 0 }
        ], { duration: 240, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
        try { await animation.finished; } catch { return; }
      }
      if (generation !== currentGeneration || !dialog.open) return;
      if (keep) liked.push(session[index]);
      index++;
      busy = false;
      render();
      // Keep focus useful after replacing the buttons, including after a touch gesture.
      body.querySelector('.picker-canteen')?.focus();
    }

    reject.addEventListener('click', () => decide(false));
    like.addEventListener('click', () => decide(true));

    let dragOrigin = 0;
    horizontalSwipe(card, {
      enabled: () => !busy,
      onStart() {
        dragOrigin = new DOMMatrixReadOnly(getComputedStyle(card).transform).m41;
        settleAnimation?.cancel();
        card.style.transform = `translate3d(${dragOrigin}px,0,0)`;
      },
      onMove(dx) {
        if (busy) return;
        settleAnimation?.cancel();
        card.style.transform = `translate3d(${dragOrigin + dx}px,0,0) rotate(${dx / 22}deg)`;
        stamp.textContent = dx > 0 ? 'LIKE' : 'NEIN';
        stamp.className = `picker-stamp ${dx > 0 ? 'is-like' : 'is-reject'}`;
        stamp.style.opacity = String(Math.min(Math.abs(dx) / 90, 1));
      },
      onEnd(dx, { velocityX = 0 } = {}) {
        if (busy) return;
        if (Math.abs(dx) >= Math.min(90, stage.clientWidth * .25) ||
            (Math.abs(dx) > 20 && Math.abs(velocityX) > .5 && dx * velocityX > 0)) decide(dx > 0);
        else {
          if (!reducedMotion()) settleAnimation = card.animate([
            { transform: card.style.transform || 'none' }, { transform: 'none' }
          ], { duration: 180, easing: 'ease-out' });
          card.style.transform = '';
          stamp.style.opacity = '0';
        }
      }
    });
  }

  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (!dialog.open) reset(); });
  button.addEventListener('click', start);
  return {
    setMeals(meals, { dateLabel = '', unavailableCount = 0 } = {}) {
      if (dialog.open) dialog.close();
      reset();
      available = meals;
      context = `${dateLabel}${unavailableCount ? ` · ${unavailableCount} Mensa-Speisepläne nicht abrufbar; nur geladene Gerichte enthalten.` : ''}`;
      button.disabled = meals.length === 0;
      button.title = meals.length ? `${meals.length} Gerichte aus den ausgewählten Mensen` : 'Keine Gerichte verfügbar. Wähle Mensen und ein Datum mit veröffentlichten Gerichten.';
    }
  };
}

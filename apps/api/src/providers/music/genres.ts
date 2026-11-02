/** Canonical lowercase genre vocabulary shared across adapters and the recommender. */
export const DEEZER_GENRES: Record<number, string> = {
  132: 'pop', 116: 'hiphop', 152: 'rock', 113: 'dance', 165: 'rnb', 85: 'indie', 106: 'electronic',
  466: 'folk', 144: 'reggae', 129: 'jazz', 98: 'classical', 173: 'soundtrack', 464: 'metal',
  169: 'soul', 153: 'blues', 197: 'latin', 2: 'african', 16: 'asian', 75: 'brazilian', 81: 'indian', 95: 'kids',
};

export const GENRE_NAMES_RU: Record<string, string> = {
  pop: 'Поп', hiphop: 'Хип-хоп', rock: 'Рок', dance: 'Танцевальная', rnb: 'R&B', indie: 'Инди',
  electronic: 'Электроника', folk: 'Фолк', reggae: 'Регги', jazz: 'Джаз', classical: 'Классика',
  soundtrack: 'Саундтреки', metal: 'Метал', soul: 'Соул', blues: 'Блюз', latin: 'Латино',
  ambient: 'Эмбиент', lofi: 'Lo-fi', lounge: 'Лаунж', world: 'Мировая', chillout: 'Чилаут',
  african: 'Африканская', asian: 'Азиатская', brazilian: 'Бразильская', indian: 'Индийская', kids: 'Детская',
};

export function canonicalGenre(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9&]+/g, '');
  const map: Record<string, string> = {
    hiphop: 'hiphop', rap: 'hiphop', raphiphop: 'hiphop', electro: 'electronic', electronic: 'electronic',
    alternative: 'indie', indie: 'indie', rb: 'rnb', 'r&b': 'rnb', rnb: 'rnb', classical: 'classical',
    classic: 'classical', lofi: 'lofi', chillout: 'chillout', soundtrack: 'soundtrack', filmsgames: 'soundtrack',
    soulfunk: 'soul', funk: 'soul',
  };
  return map[s] ?? s;
}

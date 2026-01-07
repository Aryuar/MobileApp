// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  Modal,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

const Tab = createBottomTabNavigator();

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY!;
const STORAGE_KEY = 'ai_closet_v19_rainfix'; // Versiyonu güncelledik

/* -------------------- THEME HELPERS -------------------- */
type WeatherKind = 'cold' | 'mild' | 'warm' | 'rainy';

const getAccent = (weather: WeatherKind) => {
  if (weather === 'cold') return '#8AA4FF';
  if (weather === 'mild') return '#4ECCA3';
  if (weather === 'warm') return '#FF9F43';
  return '#54A0FF'; // rainy
};

const getAccentGradient = (accent: string) => {
  return ['#111827', accent];
};

const getWeatherIcon = (weather: WeatherKind) => {
  if (weather === 'cold') return 'snow';
  if (weather === 'mild') return 'partly-sunny';
  if (weather === 'warm') return 'sunny';
  return 'rainy';
};

const getWeatherLabelTR = (weather: WeatherKind) => {
  if (weather === 'cold') return 'Soğuk';
  if (weather === 'mild') return 'Ilık';
  if (weather === 'warm') return 'Sıcak';
  return 'Yağışlı';
};

/* -------------------- JSON HELPERS -------------------- */
const extractJsonSafe = (text: string) => {
  if (!text) return null;
  let cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  const jsonPart = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(jsonPart);
  } catch {
    return null;
  }
};

const matchesWeather = (item: any, tag: string) => {
  if (Array.isArray(item.weatherTags)) return item.weatherTags.includes(tag);
  if (item.weather) return item.weather === tag;
  return false;
};

const pickRandom = (arr: any[]) => (arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);

// ---- Seeded random helpers ----
const hashString = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const mulberry32 = (seed: number) => {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pickSeeded = (arr: any[], seedKey: string) => {
  if (!arr.length) return null;
  const rng = mulberry32(hashString(seedKey));
  const idx = Math.floor(rng() * arr.length);
  return arr[idx];
};

const normalizeAIResult = (parsed: any) => {
  const category = String(parsed?.category || '').toLowerCase().trim();
  const shoeType = parsed?.shoeType != null ? String(parsed.shoeType).toLowerCase().trim() : null;

  if (!parsed.category) parsed.category = 'top';
  if (!Array.isArray(parsed.weatherTags)) parsed.weatherTags = ['mild'];
  if (parsed.shoeType === undefined) parsed.shoeType = null;

  const allowedCats = new Set(['top', 'bottom', 'outer', 'shoes']);
  if (!allowedCats.has(String(parsed.category).toLowerCase())) parsed.category = 'top';

  if (String(parsed.category).toLowerCase() === 'shoes') {
    if (shoeType === 'sneaker') parsed.weatherTags = ['cold', 'mild', 'warm'];
    else if (shoeType === 'boot') parsed.weatherTags = ['cold', 'mild', 'rainy'];
    else if (shoeType === 'sandal') parsed.weatherTags = ['warm'];
    else if (shoeType === 'rain_boot') parsed.weatherTags = ['rainy'];
    else {
      parsed.weatherTags = ['cold', 'mild', 'warm'];
      parsed.shoeType = 'sneaker';
    }
  }

  if (Array.isArray(parsed.weatherTags)) {
    parsed.weatherTags = Array.from(new Set(parsed.weatherTags.map((t: any) => String(t).toLowerCase())));
  }

  return parsed;
};

/* -------------------- HOME SCREEN -------------------- */
function HomeScreen(props: any) {
  const {
    city,
    setCity,
    cityData,
    setCityData,
    closet,
    setCloset,
    loading,
    setLoading,
    shuffleKeyByCity,
    setShuffleKeyByCity,
    globalAccent,
    setGlobalAccent,
  } = props;

  const saveCloset = async (data: any[]) => {
    setCloset(data);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  };

  const resolveWeather = (c: any): WeatherKind => {
    if (c.isRainy) return 'rainy';
    if (c.temp < 15) return 'cold';
    if (c.temp < 25) return 'mild';
    return 'warm';
  };

  const fetchWeather = async () => {
    if (!city) return;

    try {
      const geo = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          city.trim()
        )}&count=1&language=tr&format=json`
      );
      const geoData = await geo.json();
      if (!geoData.results) return Alert.alert('Şehir bulunamadı');

      const { latitude, longitude, name } = geoData.results[0];

      const wRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`
      );
      const wData = await wRes.json();

      const cw = wData?.current_weather;

      const newCity = {
        id: Date.now().toString(),
        name,
        temp: typeof cw?.temperature === 'number' ? cw.temperature : 0,
        isRainy: (cw?.weathercode ?? 0) >= 51, // 51 ve üzeri yağış kodları
        time: cw?.time ?? null,
        wind: cw?.windspeed ?? null,
      };
      setCityData((prev: any[]) => [newCity, ...prev]);
      setShuffleKeyByCity((prev: any) => ({ ...prev, [newCity.id]: 0 }));

      const w = resolveWeather(newCity);
      setGlobalAccent(getAccent(w));

      setCity('');
      Keyboard.dismiss();
    } catch {
      Alert.alert('Hata', 'Hava durumu alınamadı');
    }
  };

  const analyzeWithGemini = async (base64: string) => {
    // SENİN İSTEDİĞİN MODELİ KORUDUM (2.5)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`;

    const payload = {
      contents: [
        {
          parts: [
            {
              text: `
Analyze this clothing image.

Return ONLY valid JSON:

{
  "category": "top | bottom | outer | shoes",
  "weatherTags": ["cold","mild"] | ["cold"] | ["mild"] | ["warm"] | ["rainy"] | ["cold","mild","warm"] | ["cold","rainy"],
  "shoeType": "sneaker | boot | sandal | rain_boot | null"
}

Rules:
- If the item is shoes, category MUST be "shoes".
- Sneakers, trainers, running shoes → shoeType "sneaker"
- Boots (leather/ankle boots/winter boots) → shoeType "boot"
- Sandals/slippers → shoeType "sandal"
- Rain boots → shoeType "rain_boot"

Weather tag rules for shoes:
- sneaker → ["cold","mild","warm"]
- boot → ["cold","mild","rainy"]
- sandal → ["warm"]
- rain_boot → ["rainy"]

Non-shoes:
- Hoodies, sweatshirts, knitwear, fleece → ["cold","mild"]
- Jeans / denim pants → ["cold","mild"]
- T-shirts → ["warm"]
- Jackets / coats → ["cold", "rainy"] 
- Raincoats → ["rainy"]

IMPORTANT: If it is a jacket, coat or heavy outer, include "rainy" in tags if it looks usable in rain.
Only JSON, no explanation.
`,
            },
            { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          ],
        },
      ],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (json?.error) throw new Error(json.error.message);

    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = extractJsonSafe(rawText);

    if (!parsed) {
      console.log('AI RAW:', rawText);
      throw new Error('AI JSON formatında cevap vermedi');
    }

    return normalizeAIResult(parsed);
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('İzin Gerekli', 'Galeri izni vermen gerekiyor.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.3 });
    if (result.canceled) return;

    try {
      setLoading(true);

      const uri = result.assets[0].uri;
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      const ai = await analyzeWithGemini(base64);

      const newItem = {
        id: Date.now().toString(),
        image: uri,
        category: ai.category,
        weatherTags: ai.weatherTags,
        shoeType: ai.shoeType ?? null,
      };

      await saveCloset([newItem, ...closet]);
    } catch (e: any) {
      Alert.alert('AI Hatası', e.message);
    } finally {
      setLoading(false);
    }
  };

  const generateOutfit = (weather: string, cityId: string) => {
    const shuffleN = shuffleKeyByCity[cityId] ?? 0;

    // --- KRİTİK DÜZELTME BURADA ---
    // Yağmurlu havada artık sadece "rainy" değil, "cold" ve "mild" kıyafetleri de havuza katıyoruz.
    let allowed = [weather];
    if (weather === 'cold') allowed = ['cold', 'mild'];
    if (weather === 'rainy') allowed = ['rainy', 'cold', 'mild']; // <-- DÜZELTME: Yağmurda mont/sweat gelsin

    const pool = closet.filter((c: any) => allowed.some((tag) => matchesWeather(c, tag)));

    const pickCat = (cat: string) => {
      const items = pool.filter((c: any) => String(c.category).toLowerCase() === cat);
      // seedKey: şehir + hava + o şehrin shuffle sayısı + kategori
      return pickSeeded(items, `${cityId}|${weather}|${shuffleN}|${cat}`);
    };

    const top = pickCat('top');
    const bottom = pickCat('bottom');

    return {
      top,
      bottom,
      outer: pickCat('outer'),
      shoes: pickCat('shoes'),
      missing: { top: !top, bottom: !bottom },
    };
  };

  const shuffleForCity = (cityId: string, weather: WeatherKind) => {
    setShuffleKeyByCity((prev: any) => ({
      ...prev,
      [cityId]: (prev[cityId] ?? 0) + 1,
    }));
    setGlobalAccent(getAccent(weather));
  };

  const removeCity = (id: string) => {
    setCityData((prev: any[]) => prev.filter((c) => c.id !== id));
    setShuffleKeyByCity((prev: any) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const headerGradient = useMemo(() => getAccentGradient(globalAccent), [globalAccent]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <Modal visible={loading} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <ActivityIndicator size="large" color={globalAccent} />
            <Text style={styles.overlayTitle}>AI analiz ediyor…</Text>
            <Text style={styles.overlaySub}>Kıyafeti kategorize ediyor ve etiketliyor.</Text>
          </View>
        </View>
      </Modal>

      <LinearGradient colors={headerGradient as any} style={styles.header}>
        <SafeAreaView>
          <Text style={styles.title}>OUTFIND</Text>
          <Text style={styles.subtitle}>Find the fit for today.</Text>

          <View style={styles.searchBar}>
            <Ionicons name="location-outline" size={18} color="#A7B0C0" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.input}
              placeholder="Şehir Ara"
              value={city}
              onChangeText={setCity}
              placeholderTextColor="#73809A"
            />
            <TouchableOpacity onPress={fetchWeather} style={styles.searchBtn}>
              <Ionicons name="search" size={18} color={globalAccent} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.actionRow}>
        <View>
          <Text style={styles.countText}>{closet.length} Kıyafet</Text>
          <Text style={styles.countSub}>Dolabına parça ekleyip kombinleri güçlendir.</Text>
        </View>

        <TouchableOpacity style={[styles.addBtn, { borderColor: globalAccent }]} onPress={pickImage}>
          <Ionicons name="camera" size={18} color={globalAccent} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={cityData}
        keyExtractor={(i: any) => i.id}
        contentContainerStyle={{ paddingBottom: 22 }}
        renderItem={({ item }: any) => {
          const weatherType = resolveWeather(item);
          const accent = getAccent(weatherType);
          const outfit = generateOutfit(weatherType, item.id);

          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.city}>{item.name}</Text>

                  <View style={styles.row}>
                    <View style={[styles.badge, { borderColor: accent, backgroundColor: '#0B1220' }]}>
                      <Ionicons name={getWeatherIcon(weatherType) as any} size={14} color={accent} />
                      <Text style={[styles.badgeText, { color: accent }]}>
                        {getWeatherLabelTR(weatherType)}
                      </Text>
                    </View>

                    <Text style={styles.temp}>
                      {Math.round(item.temp)}°C
                    </Text>
                  </View>
                    <View style={styles.metaWeatherRow}>
                      <View style={styles.metaItem}>
                        <Ionicons name="leaf-outline" size={14} color={accent} />
                        <Text style={styles.metaText}>
                          {item.wind != null ? `${Math.round(item.wind)} km/h` : '--'}
                        </Text>
                      </View>
                    </View>
                  </View>

                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <LinearGradient
                    colors={getAccentGradient(accent) as any}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.shuffleBtn, { shadowColor: accent }]}
                  >
                    <TouchableOpacity onPress={() => shuffleForCity(item.id, weatherType)} style={styles.shufflePress}>
                      <Ionicons name="shuffle" size={14} color="#EAF2FF" />
                      <Text style={styles.shuffleText}>Karıştır</Text>
                    </TouchableOpacity>
                  </LinearGradient>

                  <TouchableOpacity onPress={() => removeCity(item.id)} style={{ marginLeft: 10 }}>
                    <Ionicons name="trash-outline" size={18} color="#FF5C5C" />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.outfitRow}>
                {outfit.top && <Image source={{ uri: outfit.top.image }} style={styles.outfitImg} />}
                {outfit.bottom && <Image source={{ uri: outfit.bottom.image }} style={styles.outfitImg} />}
                {outfit.outer && <Image source={{ uri: outfit.outer.image }} style={styles.outfitImg} />}
                {outfit.shoes && <Image source={{ uri: outfit.shoes.image }} style={styles.outfitImg} />}
              </View>

              {(outfit.missing.top || outfit.missing.bottom) && (
                <View style={styles.warnBox}>
                  <Ionicons name="alert-circle-outline" size={16} color={accent} />
                  <Text style={styles.warn}>
                    Daha iyi kombin için
                    {outfit.missing.top && ' üst'}
                    {outfit.missing.top && outfit.missing.bottom && ' ve'}
                    {outfit.missing.bottom && ' alt'} ekle
                  </Text>
                </View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 20 }}>
            <Text style={{ color: '#A7B0C0' }}>Şehir ekleyince hava durumu + kombin önerisi burada görünecek.</Text>
          </View>
        }
      />
    </View>
  );
}

/* -------------------- CLOSET SCREEN + FILTERS -------------------- */
function ClosetScreen({ closet, setCloset, globalAccent }: any) {
  const [selectedCat, setSelectedCat] = useState<'all' | 'top' | 'bottom' | 'outer' | 'shoes'>('all');

  const saveCloset = async (data: any[]) => {
    setCloset(data);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  };

  const removeCloth = (id: string) => {
    Alert.alert('Sil', 'Bu kıyafeti silmek istiyor musun?', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          const updated = closet.filter((c: any) => c.id !== id);
          await saveCloset(updated);
        },
      },
    ]);
  };

  const counts = useMemo(() => {
    const base = { all: closet.length, top: 0, bottom: 0, outer: 0, shoes: 0 };
    for (const c of closet) {
      const cat = String(c.category || '').toLowerCase();
      if (cat === 'top') base.top++;
      if (cat === 'bottom') base.bottom++;
      if (cat === 'outer') base.outer++;
      if (cat === 'shoes') base.shoes++;
    }
    return base;
  }, [closet]);

  const filteredCloset = useMemo(() => {
    if (selectedCat === 'all') return closet;
    return closet.filter((c: any) => String(c.category || '').toLowerCase() === selectedCat);
  }, [closet, selectedCat]);

  const chipStyle = (active: boolean) => [
    styles.chip,
    active ? [styles.chipActive, { borderColor: globalAccent }] : styles.chipInactive,
  ];

  const chipTextStyle = (active: boolean) => [
    styles.chipText,
    active ? { color: globalAccent } : styles.chipTextInactive,
  ];

  const FilterChip = ({ id, label, count }: any) => {
    const active = selectedCat === id;
    return (
      <TouchableOpacity onPress={() => setSelectedCat(id)} style={chipStyle(active)}>
        <Text style={chipTextStyle(active)}>
          {label} ({count})
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <LinearGradient colors={getAccentGradient(globalAccent) as any} style={styles.headerSmall}>
        <SafeAreaView>
          <Text style={styles.title}>Dolabım</Text>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.filtersWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <FilterChip id="all" label="All" count={counts.all} />
          <FilterChip id="top" label="Top" count={counts.top} />
          <FilterChip id="bottom" label="Bottom" count={counts.bottom} />
          <FilterChip id="outer" label="Outer" count={counts.outer} />
          <FilterChip id="shoes" label="Shoes" count={counts.shoes} />
        </ScrollView>

        <Text style={styles.filterInfo}>
          Gösterilen: {filteredCloset.length} / {closet.length}
        </Text>
      </View>

      {closet.length === 0 ? (
        <View style={{ padding: 20 }}>
          <Text style={{ color: '#A7B0C0' }}>Henüz kıyafet eklemedin.</Text>
        </View>
      ) : filteredCloset.length === 0 ? (
        <View style={{ padding: 20 }}>
          <Text style={{ color: '#A7B0C0' }}>Bu kategoride kıyafet yok.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredCloset}
          keyExtractor={(i: any) => i.id}
          contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
          numColumns={2}
          renderItem={({ item }: any) => {
            const cat = String(item.category || '').toLowerCase();
            const tags = Array.isArray(item.weatherTags) ? item.weatherTags : [];

            const badgeWeather: WeatherKind =
              tags.includes('rainy')
                ? 'rainy'
                : tags.includes('warm')
                ? 'warm'
                : tags.includes('cold')
                ? 'cold'
                : 'mild';
            const accent = getAccent(badgeWeather);

            return (
              <View style={styles.closetCard}>
                <TouchableOpacity style={styles.deleteIcon} onPress={() => removeCloth(item.id)}>
                  <Ionicons name="close-circle" size={20} color="#FF5C5C" />
                </TouchableOpacity>

                <Image source={{ uri: item.image }} style={styles.closetImg} />

                <View style={styles.metaRow}>
                  <View style={[styles.miniPill, { borderColor: accent }]}>
                    <Text style={[styles.miniPillText, { color: accent }]}>{cat.toUpperCase()}</Text>
                  </View>

                  {cat === 'shoes' && (
                    <View style={[styles.miniPill, { borderColor: '#2B3750' }]}>
                      <Text style={[styles.miniPillText, { color: '#C8D2E3' }]}>
                        {(item.shoeType || 'unknown').toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>

                <Text style={styles.metaSub}>{tags.join(', ')}</Text>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

export default function App() {
  const [city, setCity] = useState('');
  const [cityData, setCityData] = useState([]);
  const [closet, setCloset] = useState([]);
  const [loading, setLoading] = useState(false);
  const [shuffleKeyByCity, setShuffleKeyByCity] = useState({} as Record<string, number>);
  const [globalAccent, setGlobalAccent] = useState(getAccent('mild'));

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) setCloset(JSON.parse(saved));
      } catch (e) {
        console.log('AsyncStorage load error:', e);
      }
    })();
  }, []);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: globalAccent,
        tabBarInactiveTintColor: '#7C8AA5',
        tabBarIcon: ({ color, size }) => {
          const icon = route.name === 'Ana Sayfa' ? 'home' : 'shirt';
          return <Ionicons name={icon as any} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Ana Sayfa">
        {() => (
          <HomeScreen
            city={city}
            setCity={setCity}
            cityData={cityData}
            setCityData={setCityData}
            closet={closet}
            setCloset={setCloset}
            loading={loading}
            setLoading={setLoading}
            shuffleKeyByCity={shuffleKeyByCity}
            setShuffleKeyByCity={setShuffleKeyByCity}
            globalAccent={globalAccent}
            setGlobalAccent={setGlobalAccent}
          />
        )}
      </Tab.Screen>

      <Tab.Screen name="Dolabım">
        {() => <ClosetScreen closet={closet} setCloset={setCloset} globalAccent={globalAccent} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050A14' },

  header: {
    padding: 20,
    paddingBottom: 40,
    paddingTop: 48,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  headerSmall: {
    padding: 20,
    paddingBottom: 18,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },

  title: {
    color: '#EAF2FF',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.6,
    marginTop: 8,
  },

  subtitle: {
  color: '#A7B0C0',
  fontSize: 12,
  fontWeight: '700',
  textAlign: 'center',
  marginTop: 4,
  letterSpacing: 0.4,
 },
 
  searchBar: {
    backgroundColor: '#0B1220',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#1B2740',
  },
  input: { flex: 1, color: '#EAF2FF', fontWeight: '700' },
  searchBtn: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#0A0F1C',
    borderWidth: 1,
    borderColor: '#1B2740',
  },

  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    alignItems: 'center',
  },
  countText: { fontWeight: '900', color: '#EAF2FF', fontSize: 14 },
  countSub: { color: '#A7B0C0', fontWeight: '600', marginTop: 4, fontSize: 12 },
  addBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#0B1220',
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  card: {
    backgroundColor: '#0B1220',
    marginHorizontal: 14,
    marginTop: 12,
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: '#13203A',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },

  city: { fontSize: 18, fontWeight: '900', color: '#EAF2FF' },

  row: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: { marginLeft: 6, fontWeight: '900', fontSize: 12 },
  temp: { marginLeft: 10, fontWeight: '900', color: '#C8D2E3', fontSize: 13 },

  shuffleBtn: {
    borderRadius: 14,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  shufflePress: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  shuffleText: { color: '#EAF2FF', fontWeight: '900', fontSize: 12, marginLeft: 6 },

  metaWeatherRow: {
  flexDirection: 'row',
  alignItems: 'center',
  marginTop: 6,
  gap: 14,
},

metaItem: {
  flexDirection: 'row',
  alignItems: 'center',
},

metaText: {
  marginLeft: 6,
  color: '#C8D2E3',
  fontWeight: '700',
  fontSize: 12,
},

  outfitRow: {
  flexDirection: 'row',
  gap: 8,
  marginTop: 12,
},

outfitImg: {
  flex: 1,           
  height: 120,       
  borderRadius: 14,
  backgroundColor: '#0F172A',
},

  warnBox: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  warn: { color: '#A7B0C0', marginLeft: 8, fontSize: 12, fontWeight: '700' },

  filtersWrap: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  chip: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 10,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: '#0B1220' },
  chipInactive: { backgroundColor: '#0B1220', borderColor: '#1B2740' },
  chipText: { fontWeight: '900', fontSize: 12 },
  chipTextInactive: { color: '#C8D2E3' },
  filterInfo: { marginTop: 8, color: '#A7B0C0', fontWeight: '800', fontSize: 12 },

  closetCard: {
    flex: 1,
    backgroundColor: '#0B1220',
    borderRadius: 18,
    padding: 10,
    margin: 6,
    borderWidth: 1,
    borderColor: '#13203A',
  },
  closetImg: { width: '100%', height: 175, borderRadius: 14, backgroundColor: '#0F172A' },
  deleteIcon: { position: 'absolute', right: 6, top: 6, zIndex: 2 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  miniPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#0A0F1C',
  },
  miniPillText: { fontWeight: '900', fontSize: 11 },
  metaSub: { color: '#A7B0C0', fontWeight: '700', fontSize: 11, marginTop: 2 },

  tabBar: {
    backgroundColor: '#0B1220',
    borderTopWidth: 1,
    borderTopColor: '#13203A',
    height: 60,
    paddingBottom: 8,
    paddingTop: 8,
  },

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  overlayCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#0B1220',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#13203A',
    padding: 18,
    alignItems: 'center',
  },
  overlayTitle: { color: '#EAF2FF', fontWeight: '900', fontSize: 16, marginTop: 12 },
  overlaySub: { color: '#A7B0C0', fontWeight: '700', fontSize: 12, marginTop: 6, textAlign: 'center' },
});
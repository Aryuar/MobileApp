// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
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

// ✅ .env’den geliyor (EXPO_PUBLIC_GEMINI_API_KEY)
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY!;
const STORAGE_KEY = 'ai_closet_v17';

/* -------------------- HELPERS -------------------- */
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
  if (item.weather) return item.weather === tag; // eski kayıtlar için
  return false;
};

// ✅ güvenli random
const pickRandom = (arr: any[]) =>
  arr.length === 0 ? null : arr[Math.floor(Math.random() * arr.length)];

/**
 * AI sonucu ne derse desin, biz burada kesin kuralları uygularız.
 * Özellikle shoes için:
 * - sneaker -> cold,mild,warm
 * - boot -> cold,mild,rainy (warm ASLA yok)
 * - sandal -> warm
 * - rain_boot -> rainy
 */
const normalizeAIResult = (parsed: any) => {
  const category = String(parsed?.category || '').toLowerCase().trim();
  const shoeType = parsed?.shoeType != null ? String(parsed.shoeType).toLowerCase().trim() : null;

  // defaults
  if (!parsed.category) parsed.category = 'top';
  if (!Array.isArray(parsed.weatherTags)) parsed.weatherTags = ['mild'];
  if (parsed.shoeType === undefined) parsed.shoeType = null;

  // normalize category values (defensive)
  const allowedCats = new Set(['top', 'bottom', 'outer', 'shoes']);
  if (!allowedCats.has(String(parsed.category).toLowerCase())) parsed.category = 'top';

  // SHOES rules (hard override)
  if (String(parsed.category).toLowerCase() === 'shoes') {
    if (shoeType === 'sneaker') parsed.weatherTags = ['cold', 'mild', 'warm'];
    else if (shoeType === 'boot') parsed.weatherTags = ['cold', 'mild', 'rainy']; // ✅ bot yağışta da olur, warm asla yok
    else if (shoeType === 'sandal') parsed.weatherTags = ['warm'];
    else if (shoeType === 'rain_boot') parsed.weatherTags = ['rainy'];
    else {
      // shoeType gelmediyse: pratik default (sneaker gibi)
      parsed.weatherTags = ['cold', 'mild', 'warm'];
      parsed.shoeType = 'sneaker';
    }
  }

  // Deduplicate tags (optional)
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
  } = props;

  const saveCloset = async (data: any[]) => {
    setCloset(data);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  };

  // ✅ FIX: cool yok -> mild
  const resolveWeather = (c: any): string => {
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

      const temp = wData?.current_weather?.temperature;

      const newCity = {
        id: Date.now().toString(),
        name,
        temp: typeof temp === 'number' ? temp : 0,
        isRainy: (wData?.current_weather?.weathercode ?? 0) >= 51,
      };

      setCityData((prev: any[]) => [newCity, ...prev]);
      setShuffleKeyByCity((prev: any) => ({ ...prev, [newCity.id]: 0 }));

      setCity('');
      Keyboard.dismiss();
    } catch {
      Alert.alert('Hata', 'Hava durumu alınamadı');
    }
  };

  const analyzeWithGemini = async (base64: string) => {
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
  "weatherTags": ["cold","mild"] | ["cold"] | ["mild"] | ["warm"] | ["rainy"] | ["cold","mild","warm"],
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
- boot → ["cold","mild","rainy"]   (NEVER include "warm")
- sandal → ["warm"]
- rain_boot → ["rainy"]

Non-shoes:
- Hoodies, sweatshirts, knitwear, fleece → ["cold","mild"]
- Jeans / denim pants → ["cold","mild"]
- T-shirts → ["warm"]
- Jackets / coats → ["cold"]
- Raincoats → ["rainy"]

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
        shoeType: ai.shoeType ?? null, // ✅ yeni alan
      };

      await saveCloset([newItem, ...closet]);
    } catch (e: any) {
      Alert.alert('AI Hatası', e.message);
    } finally {
      setLoading(false);
    }
  };

  const generateOutfit = (weather: string, cityId: string) => {
    // refresh dependency (Karıştır butonu)
    const _ = shuffleKeyByCity[cityId] ?? 0;

    const allowed = weather === 'cold' ? ['cold', 'mild'] : [weather];

    // weather filtre
    const pool = closet.filter((c: any) => allowed.some((tag) => matchesWeather(c, tag)));

    const pick = (cat: string) => {
      const items = pool.filter((c: any) => String(c.category).toLowerCase() === cat);
      return pickRandom(items);
    };

    const top = pick('top');
    const bottom = pick('bottom');

    return {
      top,
      bottom,
      outer: pick('outer'),
      shoes: pick('shoes'),
      missing: { top: !top, bottom: !bottom },
    };
  };

  const shuffleForCity = (cityId: string) => {
    setShuffleKeyByCity((prev: any) => ({
      ...prev,
      [cityId]: (prev[cityId] ?? 0) + 1,
    }));
  };

  const removeCity = (id: string) => {
    setCityData((prev: any[]) => prev.filter((c) => c.id !== id));
    setShuffleKeyByCity((prev: any) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <LinearGradient colors={['#1e3c72', '#2a5298']} style={styles.header}>
        <SafeAreaView>
          <Text style={styles.title}>AI Stil Asistanı</Text>

          <View style={styles.searchBar}>
            <TextInput
              style={styles.input}
              placeholder="Şehir Ara"
              value={city}
              onChangeText={setCity}
              placeholderTextColor="#999"
            />
            <TouchableOpacity onPress={fetchWeather}>
              <Ionicons name="search" size={22} color="#1e3c72" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.actionRow}>
        <Text style={styles.countText}>{closet.length} Kıyafet</Text>
        <TouchableOpacity style={styles.addBtn} onPress={pickImage}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name="camera" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={cityData}
        keyExtractor={(i: any) => i.id}
        contentContainerStyle={{ paddingBottom: 20 }}
        renderItem={({ item }: any) => {
          const weatherType = resolveWeather(item);
          const outfit = generateOutfit(weatherType, item.id);

          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.city}>{item.name}</Text>
                  <Text style={styles.temp}>
                    {Math.round(item.temp)}°C · {weatherType}
                    {item.isRainy ? ' · Yağışlı' : ''}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity onPress={() => shuffleForCity(item.id)} style={styles.shuffleBtn}>
                    <Ionicons name="shuffle" size={16} color="#fff" />
                    <Text style={styles.shuffleText}>Karıştır</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => removeCity(item.id)} style={{ marginLeft: 10 }}>
                    <Ionicons name="trash" size={18} color="#e74c3c" />
                  </TouchableOpacity>
                </View>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {outfit.top && <Image source={{ uri: outfit.top.image }} style={styles.img} />}
                {outfit.bottom && <Image source={{ uri: outfit.bottom.image }} style={styles.img} />}
                {outfit.outer && <Image source={{ uri: outfit.outer.image }} style={styles.img} />}
                {outfit.shoes && <Image source={{ uri: outfit.shoes.image }} style={styles.img} />}
              </ScrollView>

              {(outfit.missing.top || outfit.missing.bottom) && (
                <Text style={styles.warn}>
                  ⚠️ Daha iyi kombin için
                  {outfit.missing.top && ' üst'}
                  {outfit.missing.top && outfit.missing.bottom && ' ve'}
                  {outfit.missing.bottom && ' alt'} ekle
                </Text>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 20 }}>
            <Text style={{ color: '#666' }}>Şehir ekleyince hava durumu + kombin önerisi burada görünecek.</Text>
          </View>
        }
      />
    </View>
  );
}

/* -------------------- CLOSET SCREEN + FILTERS -------------------- */
function ClosetScreen({ closet, setCloset }: any) {
  const [selectedCat, setSelectedCat] = useState<'all' | 'top' | 'bottom' | 'outer' | 'shoes'>('all');

  const saveCloset = async (data: any[]) => {
    setCloset(data);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  };

  const removeCloth = (id: string) => {
    Alert.alert('Sil', 'Bu kıyafeti silmek istiyor musun?', [
      { text: 'İptal' },
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

  const FilterChip = ({ id, label, count }: any) => {
    const active = selectedCat === id;
    return (
      <TouchableOpacity
        onPress={() => setSelectedCat(id)}
        style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
      >
        <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextInactive]}>
          {label} ({count})
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <LinearGradient colors={['#1e3c72', '#2a5298']} style={styles.headerSmall}>
        <SafeAreaView>
          <Text style={styles.title}>Dolabım</Text>
        </SafeAreaView>
      </LinearGradient>

      {/* Filters */}
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
          <Text style={{ color: '#666' }}>Henüz kıyafet eklemedin.</Text>
        </View>
      ) : filteredCloset.length === 0 ? (
        <View style={{ padding: 20 }}>
          <Text style={{ color: '#666' }}>Bu kategoride kıyafet yok.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredCloset}
          keyExtractor={(i: any) => i.id}
          contentContainerStyle={{ padding: 15, paddingBottom: 30 }}
          numColumns={2}
          renderItem={({ item }: any) => (
            <View style={styles.closetCard}>
              <TouchableOpacity style={styles.deleteIcon} onPress={() => removeCloth(item.id)}>
                <Ionicons name="close-circle" size={20} color="#e74c3c" />
              </TouchableOpacity>

              <Image source={{ uri: item.image }} style={styles.closetImg} />

              <Text style={styles.meta}>{String(item.category || '').toUpperCase()}</Text>

              {/* Shoes detail */}
              {String(item.category || '').toLowerCase() === 'shoes' && (
                <Text style={styles.metaSub}>
                  {String(item.shoeType || 'unknown')}
                </Text>
              )}

              <Text style={styles.metaSub}>{(item.weatherTags || []).join(', ')}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

/* -------------------- APP (TABS) -------------------- */
export default function App() {
  const [city, setCity] = useState('');
  const [cityData, setCityData] = useState([]);
  const [closet, setCloset] = useState([]);
  const [loading, setLoading] = useState(false);
  const [shuffleKeyByCity, setShuffleKeyByCity] = useState({} as Record<string, number>);

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
        tabBarActiveTintColor: '#1e3c72',
        tabBarInactiveTintColor: '#777',
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
          />
        )}
      </Tab.Screen>

      <Tab.Screen name="Dolabım">
        {() => <ClosetScreen closet={closet} setCloset={setCloset} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

/* -------------------- STYLES -------------------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },

  header: {
    padding: 20,
    paddingBottom: 40,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerSmall: {
    padding: 20,
    paddingBottom: 20,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },

  title: { color: '#fff', fontSize: 24, fontWeight: 'bold', textAlign: 'center' },

  searchBar: {
    backgroundColor: '#fff',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    marginTop: 20,
  },
  input: { flex: 1, color: '#000' },

  actionRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center' },
  countText: { fontWeight: '700', color: '#333' },
  addBtn: { backgroundColor: '#4ECCA3', padding: 12, borderRadius: 12 },

  card: { backgroundColor: '#fff', marginHorizontal: 15, marginTop: 15, borderRadius: 20, padding: 15 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  city: { fontSize: 18, fontWeight: 'bold' },
  temp: { fontSize: 14, color: '#555', marginTop: 4 },

  img: { width: 100, height: 130, borderRadius: 12, marginRight: 10, backgroundColor: '#eee' },
  warn: { color: '#e67e22', marginTop: 8, fontSize: 12 },

  shuffleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e3c72',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  shuffleText: { color: '#fff', fontWeight: '700', fontSize: 12, marginLeft: 6 },

  // Filters
  filtersWrap: { paddingHorizontal: 15, paddingTop: 12, paddingBottom: 6 },
  chip: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, marginRight: 10 },
  chipActive: { backgroundColor: '#1e3c72' },
  chipInactive: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d0d7e2' },
  chipText: { fontWeight: '800', fontSize: 12 },
  chipTextActive: { color: '#fff' },
  chipTextInactive: { color: '#1e3c72' },
  filterInfo: { marginTop: 8, color: '#555', fontWeight: '700', fontSize: 12 },

  // Closet cards
  closetCard: { flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 10, margin: 6 },
  closetImg: { width: '100%', height: 180, borderRadius: 12, backgroundColor: '#eee' },
  deleteIcon: { position: 'absolute', right: 6, top: 6, zIndex: 2 },
  meta: { marginTop: 8, fontWeight: '800', color: '#333', textAlign: 'center', fontSize: 12 },
  metaSub: { marginTop: 2, color: '#666', textAlign: 'center', fontSize: 11 },
});

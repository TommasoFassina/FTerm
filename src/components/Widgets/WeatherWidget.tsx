import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { X, Sun, CloudRain, CloudSnow, Cloud, Wind, Droplets, Thermometer, Loader2, AlertCircle, Eye, Zap } from 'lucide-react'

interface WeatherData {
  city: string
  resolvedCity: string
  temp: number
  feelsLike: number
  condition: 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'windy'
  humidity: number
  wind: number
  high: number
  low: number
  description: string
  uvIndex: number
  visibility: number
}

interface Props {
  city: string
  onClose: () => void
}

const CONDITIONS: Record<WeatherData['condition'], { icon: React.ReactNode; label: string }> = {
  sunny: { icon: <Sun size={56} className="text-yellow-300" />, label: 'Sunny' },
  cloudy: { icon: <Cloud size={56} className="text-gray-300" />, label: 'Cloudy' },
  rainy: { icon: <CloudRain size={56} className="text-blue-300" />, label: 'Rainy' },
  snowy: { icon: <CloudSnow size={56} className="text-blue-100" />, label: 'Snowy' },
  windy: { icon: <Wind size={56} className="text-teal-300" />, label: 'Windy' },
}

function mapCondition(desc: string): WeatherData['condition'] {
  const d = desc.toLowerCase()
  if (d.includes('snow') || d.includes('sleet') || d.includes('blizzard')) return 'snowy'
  if (d.includes('rain') || d.includes('drizzle') || d.includes('shower') || d.includes('thunder')) return 'rainy'
  if (d.includes('wind') || d.includes('gale')) return 'windy'
  if (d.includes('cloud') || d.includes('overcast') || d.includes('fog') || d.includes('mist')) return 'cloudy'
  return 'sunny'
}

export default function WeatherWidget({ city, onClose }: Props) {
  const [data, setData] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const url = city
      ? `https://wttr.in/${encodeURIComponent(city)}?format=j1`
      : `https://wttr.in/?format=j1`
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(json => {
        if (cancelled) return
        const cc = json.current_condition?.[0]
        const weather = json.weather?.[0]
        const area = json.nearest_area?.[0]
        if (!cc) throw new Error('Unexpected response format')
        const desc = cc.weatherDesc?.[0]?.value ?? ''
        const areaName = area?.areaName?.[0]?.value ?? ''
        const country = area?.country?.[0]?.value ?? ''
        const resolvedCity = [areaName, country].filter(Boolean).join(', ') || city || 'Auto-detected'
        setData({
          city,
          resolvedCity,
          temp: parseInt(cc.temp_C, 10) || 0,
          feelsLike: parseInt(cc.FeelsLikeC, 10) || 0,
          condition: mapCondition(desc),
          humidity: parseInt(cc.humidity, 10) || 0,
          wind: parseInt(cc.windspeedKmph, 10) || 0,
          high: weather ? parseInt(weather.maxtempC, 10) || 0 : parseInt(cc.temp_C, 10) || 0,
          low: weather ? parseInt(weather.mintempC, 10) || 0 : parseInt(cc.temp_C, 10) || 0,
          description: desc,
          uvIndex: parseInt(weather?.uvIndex ?? '0', 10) || 0,
          visibility: parseInt(cc.visibility ?? '0', 10) || 0,
        })
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message ?? 'Failed to fetch weather')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [city])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      className="absolute inset-0 z-30 flex items-start justify-center pt-10 px-6"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.2, type: 'spring', stiffness: 260, damping: 20 }}
        className="relative w-full max-w-sm rounded-2xl overflow-hidden border border-white/15 shadow-2xl"
        style={{ backdropFilter: 'blur(20px)', background: 'linear-gradient(135deg, rgba(13,17,23,0.85), rgba(13,17,23,0.7))' }}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white z-10"
        >
          <X size={16} />
        </button>

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 text-white/40 gap-3">
            <Loader2 size={24} className="animate-spin" />
            <span className="text-sm">Fetching weather for {city}…</span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-16 text-red-400 gap-3">
            <AlertCircle size={24} />
            <span className="text-sm text-center px-6">{error}</span>
          </div>
        )}

        {data && !loading && (
          <>
            <div className="px-6 pt-6 pb-4">
              <div className="text-sm text-white/50 uppercase tracking-widest mb-1">{data.resolvedCity}</div>
              <div className="flex items-end gap-4 mb-2">
                <div className="text-7xl font-thin text-white leading-none">{data.temp}°</div>
                <div className="pb-2">{CONDITIONS[data.condition].icon}</div>
              </div>
              <div className="text-white/70 text-lg mb-1">{data.description || CONDITIONS[data.condition].label}</div>
              <div className="text-white/40 text-sm">Feels like {data.feelsLike}° · H:{data.high}° L:{data.low}°</div>
            </div>
            <div className="grid grid-cols-5 gap-px border-t border-white/10">
              <StatItem icon={<Droplets size={14} className="text-blue-400" />} label="Humidity" value={`${data.humidity}%`} />
              <StatItem icon={<Wind size={14} className="text-teal-400" />} label="Wind" value={`${data.wind}km/h`} />
              <StatItem icon={<Thermometer size={14} className="text-orange-400" />} label="Feels" value={`${data.feelsLike}°`} />
              <StatItem icon={<Eye size={14} className="text-purple-400" />} label="Visibility" value={`${data.visibility}km`} />
              <StatItem icon={<Zap size={14} className="text-yellow-400" />} label="UV" value={`${data.uvIndex}`} />
            </div>
            <div className="px-4 py-2 text-center text-xs text-white/20">wttr.in · Press Esc to close</div>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}

function StatItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center py-3 bg-white/5">
      <div className="mb-1">{icon}</div>
      <div className="text-white font-medium text-sm">{value}</div>
      <div className="text-white/40 text-xs">{label}</div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from './errors'
import { getPosition, type Fix } from './geo'

// 位置情報を取得して、状態(取得中・成功・失敗)と、やり直しの関数を返す
export function useLocation() {
  const [fix, setFix] = useState<Fix | null>(null)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)

  const retry = useCallback(() => {
    setLoading(true); setError(''); setCode('')
    getPosition()
      .then((f) => { if (alive.current) { setFix(f); setLoading(false) } })
      .catch((e) => { if (alive.current) { setError(errorMessage(e)); setCode(e instanceof Error ? e.message : ''); setLoading(false) } })
  }, [])

  useEffect(() => { alive.current = true; retry(); return () => { alive.current = false } }, [retry])
  return { fix, error, code, loading, retry }
}

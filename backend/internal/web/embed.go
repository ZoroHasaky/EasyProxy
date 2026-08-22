// Package web 内嵌前端静态资源（构建时由前端产物填充）
package web

import "embed"

//go:embed all:dist
var Dist embed.FS

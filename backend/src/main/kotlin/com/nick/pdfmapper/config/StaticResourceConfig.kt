package com.nick.pdfmapper.config

import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Configuration
import org.springframework.core.io.Resource
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import org.springframework.web.servlet.resource.PathResourceResolver
import java.io.IOException

/**
 * Serves the frontend static build (when present) and falls back to index.html for SPA routing.
 * Use app.staticLocations for production (e.g. file:/app/static/) or leave default (classpath:/static/).
 */
@Configuration
class StaticResourceConfig(
  @Value("\${app.staticLocations:classpath:/static/}") private val staticLocations: String,
) : WebMvcConfigurer {

  override fun addResourceHandlers(registry: ResourceHandlerRegistry) {
    registry.addResourceHandler("/**")
      .addResourceLocations(*staticLocations.split(',').map { it.trim() }.toTypedArray())
      .resourceChain(true)
      .addResolver(object : PathResourceResolver() {
        @Throws(IOException::class)
        override fun getResource(resourcePath: String, location: Resource): Resource? {
          val path = resourcePath.trimStart('/')
          val resource = location.createRelative(if (path.isEmpty()) "index.html" else path)
          return if (resource.exists() && resource.isReadable) resource
          else location.createRelative("index.html").takeIf { it.exists() && it.isReadable }
        }
      })
  }
}

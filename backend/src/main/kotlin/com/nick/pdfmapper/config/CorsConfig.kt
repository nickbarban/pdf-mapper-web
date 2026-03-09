package com.nick.pdfmapper.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.servlet.config.annotation.CorsRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

@Configuration
class CorsConfig {
  @Bean
  fun corsConfigurer(): WebMvcConfigurer = object : WebMvcConfigurer {
    override fun addCorsMappings(registry: CorsRegistry) {
      registry.addMapping("/api/**")
        .allowedOrigins(
          "http://localhost:5172",
          "http://127.0.0.1:5172"
        )
        .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
        .allowedHeaders("*")
    }
  }
}
